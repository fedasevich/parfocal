import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.availability import MemberAvailability, team_availability
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Permission, require
from parfocal_api.projects import code_of as project_code
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.tables import (
    Availability,
    ProjectRole,
    TaskSplit,
    memberships,
    project_members,
    projects,
    review_assignments,
    review_decisions,
    review_task_slides,
    review_tasks,
    task_nudges,
)
from parfocal_common.db import CURRENT_TENANT


class TeamReviewerStatus(StrEnum):
    ON_TRACK = "on-track"
    BEHIND = "behind"
    NOT_STARTED = "not-started"
    AWAY = "away"
    DONE = "done"


class TeamReviewer(BaseModel):
    user_id: uuid.UUID
    slides_done: int = Field(ge=0)
    slides_assigned: int = Field(ge=0)
    status: TeamReviewerStatus
    minutes_left: int | None = Field(ge=0)
    away_until: date | None
    assigned_at: datetime
    last_decision_at: datetime | None
    nudged_at: datetime | None


class TeamProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class TeamTask(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    project: TeamProject
    slides: int = Field(ge=0)
    split: Literal["all", "even"]
    sent_on: date
    due_on: date
    signed_on: date | None
    reviewers: list[TeamReviewer]


class TeamWorkload(BaseModel):
    as_of: datetime
    open: list[TeamTask]
    done: list[TeamTask]


class ReviewerWorkload(BaseModel):
    user_id: uuid.UUID
    open_tasks: int = Field(ge=0)


@dataclass(frozen=True)
class Pace:
    done: int
    assigned: int
    assigned_at: datetime
    last_decision_at: datetime | None


me_router = APIRouter(prefix="/api/me", tags=["me"])
tenant_router = APIRouter(prefix="/api/tenant", tags=["tenant"])


def reviewer_status(
    pace: Pace, today: date, sent_on: date, due_on: date, away: bool
) -> TeamReviewerStatus:
    span = (due_on - sent_on).days
    share = min(1.0, max(0.0, (today - sent_on).days / span)) if span > 0 else 1.0
    if pace.assigned - pace.done <= 0:
        return TeamReviewerStatus.DONE
    if away:
        return TeamReviewerStatus.AWAY
    if pace.done == 0 and today <= due_on:
        return TeamReviewerStatus.NOT_STARTED
    if today > due_on or pace.done / pace.assigned < share:
        return TeamReviewerStatus.BEHIND
    return TeamReviewerStatus.ON_TRACK


def minutes_left(pace: Pace) -> int | None:
    left = max(0, pace.assigned - pace.done)
    if left == 0:
        return 0
    if pace.done == 0 or pace.last_decision_at is None:
        return None
    spent = (pace.last_decision_at - pace.assigned_at).total_seconds() / 60
    return max(1, round(spent / pace.done * left))


def away_until(availability: MemberAvailability | None) -> tuple[bool, date | None]:
    if availability is None or availability.status is not Availability.AWAY:
        return False, None
    return True, availability.until.date() if availability.until else None


async def paces_of(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict[uuid.UUID, Pace]]:
    last = (
        select(
            review_decisions.c.task_id,
            review_decisions.c.user_id,
            func.max(review_decisions.c.updated_at).label("at"),
        )
        .where(review_decisions.c.task_id.in_(task_ids))
        .group_by(review_decisions.c.task_id, review_decisions.c.user_id)
        .subquery()
    )
    rows = await connection.execute(
        select(
            review_assignments.c.task_id,
            review_assignments.c.user_id,
            func.count().label("assigned"),
            func.count(review_assignments.c.submitted_at).label("done"),
            func.min(review_assignments.c.assigned_at).label("assigned_at"),
            func.max(last.c.at).label("last_decision_at"),
        )
        .outerjoin(
            last,
            (last.c.task_id == review_assignments.c.task_id)
            & (last.c.user_id == review_assignments.c.user_id),
        )
        .where(review_assignments.c.task_id.in_(task_ids))
        .group_by(review_assignments.c.task_id, review_assignments.c.user_id)
        .order_by(func.min(review_assignments.c.assigned_at), review_assignments.c.user_id)
    )
    paces: dict[uuid.UUID, dict[uuid.UUID, Pace]] = defaultdict(dict)
    for row in rows:
        paces[row.task_id][row.user_id] = Pace(
            row.done, row.assigned, row.assigned_at, row.last_decision_at
        )
    return paces


async def nudges_of(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[tuple[uuid.UUID, uuid.UUID], datetime]:
    rows = await connection.execute(
        select(task_nudges.c.task_id, task_nudges.c.user_id, func.max(task_nudges.c.sent_at))
        .where(task_nudges.c.task_id.in_(task_ids))
        .group_by(task_nudges.c.task_id, task_nudges.c.user_id)
    )
    return {(row[0], row[1]): row[2] for row in rows}


async def slide_counts(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    rows = await connection.execute(
        select(review_task_slides.c.task_id, func.count())
        .where(review_task_slides.c.task_id.in_(task_ids))
        .group_by(review_task_slides.c.task_id)
    )
    return {row[0]: row[1] for row in rows}


async def owned_tasks(connection: AsyncConnection, user_id: uuid.UUID) -> list[Any]:
    mine = select(project_members.c.project_id).where(
        project_members.c.user_id == user_id, project_members.c.role == ProjectRole.OWNER
    )
    rows = await connection.execute(
        select(
            review_tasks.c.id,
            review_tasks.c.number,
            review_tasks.c.name,
            review_tasks.c.split,
            review_tasks.c.due_on,
            review_tasks.c.created_at,
            review_tasks.c.signed_off_at,
            projects.c.id.label("project_id"),
            projects.c.number.label("project_number"),
            projects.c.name.label("project_name"),
        )
        .join(projects, projects.c.id == review_tasks.c.project_id)
        .where(
            review_tasks.c.project_id.in_(mine),
            review_tasks.c.archived_at.is_(None),
            projects.c.deleted_at.is_(None),
        )
        .order_by(review_tasks.c.created_at, review_tasks.c.id)
    )
    return list(rows)


@me_router.get("/team", operation_id="listTeamWorkload")
async def list_team_workload(
    principal: CurrentPrincipal, connection: TenantConnection
) -> TeamWorkload:
    member = member_of(principal)
    now = await connection.scalar(select(func.now()))
    assert isinstance(now, datetime)
    tasks = await owned_tasks(connection, member.user_id)
    ids = [task.id for task in tasks]
    paces = await paces_of(connection, ids)
    nudges = await nudges_of(connection, ids)
    counts = await slide_counts(connection, ids)
    availability = {item.user_id: item for item in await team_availability(connection)}
    today = now.date()

    def shown(task: Any) -> TeamTask:
        sent_on = task.created_at.date()
        due_on = task.due_on or sent_on
        reviewers: list[TeamReviewer] = []
        for user_id, pace in paces.get(task.id, {}).items():
            away, until = away_until(availability.get(user_id))
            reviewers.append(
                TeamReviewer(
                    user_id=user_id,
                    slides_done=pace.done,
                    slides_assigned=pace.assigned,
                    status=reviewer_status(pace, today, sent_on, due_on, away),
                    minutes_left=minutes_left(pace),
                    away_until=until,
                    assigned_at=pace.assigned_at,
                    last_decision_at=pace.last_decision_at,
                    nudged_at=nudges.get((task.id, user_id)),
                )
            )
        return TeamTask(
            id=task.id,
            code=task_code(task.number),
            name=task.name,
            project=TeamProject(
                id=task.project_id,
                code=project_code(task.project_number),
                name=task.project_name,
            ),
            slides=counts.get(task.id, 0),
            split="all" if task.split == TaskSplit.EVERYONE else "even",
            sent_on=sent_on,
            due_on=due_on,
            signed_on=task.signed_off_at.date() if task.signed_off_at else None,
            reviewers=reviewers,
        )

    open_tasks = sorted(
        (task for task in tasks if task.signed_off_at is None),
        key=lambda task: task.due_on or task.created_at.date(),
    )
    done_tasks = sorted(
        (task for task in tasks if task.signed_off_at is not None),
        key=lambda task: task.signed_off_at,
        reverse=True,
    )
    return TeamWorkload(
        as_of=now,
        open=[shown(task) for task in open_tasks],
        done=[shown(task) for task in done_tasks],
    )


@tenant_router.get(
    "/workload", operation_id="listReviewerWorkload", **require(Permission.SEE_PEOPLE)
)
async def list_reviewer_workload(connection: TenantConnection) -> list[ReviewerWorkload]:
    open_work = (
        select(
            review_assignments.c.user_id,
            func.count(func.distinct(review_assignments.c.task_id)).label("tasks"),
        )
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(
            review_assignments.c.submitted_at.is_(None),
            review_tasks.c.signed_off_at.is_(None),
            review_tasks.c.archived_at.is_(None),
        )
        .group_by(review_assignments.c.user_id)
        .subquery()
    )
    rows = await connection.execute(
        select(memberships.c.user_id, func.coalesce(open_work.c.tasks, 0))
        .outerjoin(open_work, open_work.c.user_id == memberships.c.user_id)
        .where(memberships.c.tenant_id == literal_column(CURRENT_TENANT))
        .order_by(memberships.c.user_id)
    )
    return [ReviewerWorkload(user_id=row[0], open_tasks=row[1]) for row in rows]
