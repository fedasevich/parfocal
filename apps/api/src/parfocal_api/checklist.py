import uuid
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import member_of
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import LIVE
from parfocal_api.projects import code_of as project_code
from parfocal_api.tables import (
    opinions,
    project_members,
    projects,
    resume_states,
    review_assignments,
    review_tasks,
    slides,
    tenants,
    thread_messages,
    threads,
    users,
    verdicts,
)

SAMPLE = projects.c.sample.is_(True)


class ChecklistStepKey(StrEnum):
    CONFIRM_EMAIL = "confirm-email"
    JOIN_WORKSPACE = "join-workspace"
    OPEN_SAMPLE = "open-sample"
    GUIDED_REVIEW = "guided-review"
    COMMENT = "comment"
    OPINION = "opinion"


class ChecklistStep(BaseModel):
    key: ChecklistStepKey
    label: str
    done: bool


class SampleProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    slides: int = Field(ge=0)


class Checklist(BaseModel):
    hidden: bool
    steps: list[ChecklistStep]
    sample_project: SampleProject | None


router = APIRouter(prefix="/api/me", tags=["me"])


def in_sample(project_column: Any) -> Any:
    return project_column.in_(select(projects.c.id).where(SAMPLE))


async def sample_of(connection: AsyncConnection, me: uuid.UUID) -> SampleProject | None:
    row = (
        await connection.execute(
            select(projects.c.id, projects.c.number, projects.c.name)
            .join(project_members, project_members.c.project_id == projects.c.id)
            .where(project_members.c.user_id == me, SAMPLE, LIVE, projects.c.archived_at.is_(None))
            .order_by(projects.c.number)
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        return None
    count = await connection.scalar(
        select(func.count()).where(slides.c.project_id == row.id, slides.c.deleted_at.is_(None))
    )
    return SampleProject(
        id=row.id, code=project_code(row.number), name=row.name, slides=int(count or 0)
    )


async def done_steps(connection: AsyncConnection, person: MemberPrincipal) -> dict[str, bool]:
    me = person.user_id
    reviewed = exists().where(
        review_assignments.c.user_id == me,
        review_assignments.c.submitted_at.is_not(None),
        review_assignments.c.task_id.in_(
            select(review_tasks.c.id).where(in_sample(review_tasks.c.project_id))
        ),
    )
    opened = exists().where(
        resume_states.c.user_id == me,
        resume_states.c.slide_id.in_(select(slides.c.id).where(in_sample(slides.c.project_id))),
    ) | exists().where(verdicts.c.user_id == me, in_sample(verdicts.c.project_id))
    commented = exists().where(
        thread_messages.c.user_id == me,
        thread_messages.c.thread_id == threads.c.id,
        threads.c.anchor_kind == "object",
    )
    answered = exists().where(opinions.c.user_id == me)
    email = select(users.c.email.is_not(None)).where(users.c.id == me).scalar_subquery()
    row = (
        await connection.execute(
            select(
                email.label("email"),
                (opened | reviewed).label("opened"),
                reviewed.label("reviewed"),
                commented.label("commented"),
                answered.label("answered"),
            )
        )
    ).one()
    return {
        "email": bool(row.email),
        "opened": bool(row.opened),
        "reviewed": bool(row.reviewed),
        "commented": bool(row.commented),
        "answered": bool(row.answered),
    }


@router.get("/checklist", operation_id="getMyChecklist")
async def get_my_checklist(principal: CurrentPrincipal, connection: TenantConnection) -> Checklist:
    person = member_of(principal)
    workspace = await connection.scalar(
        select(tenants.c.name).where(tenants.c.id == person.tenant_id)
    )
    done = await done_steps(connection, person)
    steps = [
        ChecklistStep(
            key=ChecklistStepKey.CONFIRM_EMAIL, label="Confirm your email", done=done["email"]
        ),
        ChecklistStep(
            key=ChecklistStepKey.JOIN_WORKSPACE,
            label=f"Join {workspace or 'your workspace'}",
            done=True,
        ),
        ChecklistStep(
            key=ChecklistStepKey.OPEN_SAMPLE, label="Open the sample project", done=done["opened"]
        ),
        ChecklistStep(
            key=ChecklistStepKey.GUIDED_REVIEW,
            label="Review one slide in guided review",
            done=done["reviewed"],
        ),
        ChecklistStep(
            key=ChecklistStepKey.COMMENT, label="Comment on an object ID", done=done["commented"]
        ),
        ChecklistStep(
            key=ChecklistStepKey.OPINION,
            label="Submit your first opinion form",
            done=done["answered"],
        ),
    ]
    return Checklist(
        hidden=all(step.done for step in steps),
        steps=steps,
        sample_project=await sample_of(connection, person.user_id),
    )
