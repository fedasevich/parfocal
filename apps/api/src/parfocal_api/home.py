import math
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy import exists, func, literal, literal_column, select, union_all
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.announcements import Announcement, current_announcements
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import open_count, queue_of
from parfocal_api.my_work import MyStatus, MyTask, ProjectRef, my_review_tasks
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Grant, Permission, grant_of, in_project
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import NotFoundError
from parfocal_api.project_access import assigned_slides, reads_whole
from parfocal_api.projects import LIVE, NOT_SAMPLE
from parfocal_api.projects import code_of as project_code
from parfocal_api.reviewed_export import LETTERS
from parfocal_api.tables import (
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    ResumeMode,
    annotations,
    cases,
    project_members,
    projects,
    result_sets,
    resume_states,
    review_assignments,
    review_decisions,
    review_edits,
    review_task_slides,
    review_tasks,
    slides,
)
from parfocal_common.db import CURRENT_TENANT
from parfocal_common.object_ids import ObjectId

STRIP = 4
WEEK = timedelta(days=7)
OPEN = (MyStatus.IN_REVIEW, MyStatus.NOT_STARTED)


def finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("must be a finite number")
    return value


Coordinate = Annotated[float, AfterValidator(finite)]


class ResumeCamera(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: Coordinate
    y: Coordinate
    z: Coordinate


class ResumeChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    slide_id: uuid.UUID
    mode: ResumeMode
    object_id: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    camera: ResumeCamera | None = None


class ResumeState(ResumeChange):
    updated_at: datetime


class ResumeTarget(BaseModel):
    task_id: uuid.UUID
    task_code: str
    task_name: str
    project: ProjectRef
    slide_id: uuid.UUID
    slide_label: str
    case_label: str | None
    position: int
    slides_assigned: int
    object_id: str | None
    decisions_on_slide: int
    due_on: date | None
    blinded: bool
    mode: ResumeMode
    camera: ResumeCamera | None


class StripSlide(BaseModel):
    id: uuid.UUID
    label: str
    reviewed: bool


class HomeProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    colour: int
    privacy_mode: PrivacyMode
    my_role: ProjectRole
    members: int
    slides: int
    result_sets: int
    reviewed_slides: int
    strip: list[StripSlide]


class Week(BaseModel):
    since: datetime
    objects_checked: int
    agreed: int
    agree_share: float | None
    open_disagreements: int | None


class Home(BaseModel):
    resume: ResumeTarget | None
    tasks: list[MyTask]
    projects: list[HomeProject]
    slides_without_results: int
    week: Week
    announcements: list[Announcement]


router = APIRouter(prefix="/api/me", tags=["me"])


def open_tasks(tasks: list[MyTask]) -> list[MyTask]:
    return sorted(
        (task for task in tasks if task.status in OPEN),
        key=lambda task: (task.due_on is None, task.due_on or date.max, task.code),
    )


async def last_activity(connection: AsyncConnection, me: uuid.UUID) -> Any:
    touched = union_all(
        select(
            review_decisions.c.task_id,
            review_decisions.c.slide_id,
            review_decisions.c.kind,
            review_decisions.c.number,
            literal(False).label("person"),
            review_decisions.c.updated_at.label("at"),
        ).where(review_decisions.c.user_id == me),
        select(
            review_edits.c.task_id,
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
            literal(False).label("person"),
            review_edits.c.updated_at.label("at"),
        ).where(review_edits.c.user_id == me),
        select(
            annotations.c.task_id,
            annotations.c.slide_id,
            annotations.c.kind,
            annotations.c.number,
            literal(True).label("person"),
            annotations.c.updated_at.label("at"),
        ).where(
            annotations.c.created_by_user_id == me,
            annotations.c.task_id.is_not(None),
            annotations.c.deleted_at.is_(None),
            annotations.c.kind.in_(list(LETTERS)),
        ),
    ).subquery()
    return (
        await connection.execute(
            still_open(select(touched), touched.c.task_id, touched.c.slide_id, me)
            .order_by(touched.c.at.desc())
            .limit(1)
        )
    ).one_or_none()


def still_open(query: Any, task_column: Any, slide_column: Any, me: uuid.UUID) -> Any:
    return (
        query.join(
            review_assignments,
            (review_assignments.c.task_id == task_column)
            & (review_assignments.c.slide_id == slide_column)
            & (review_assignments.c.user_id == me),
        )
        .join(review_tasks, review_tasks.c.id == task_column)
        .where(
            review_assignments.c.submitted_at.is_(None),
            review_assignments.c.released_at.is_(None),
            review_tasks.c.archived_at.is_(None),
            review_tasks.c.signed_off_at.is_(None),
        )
    )


async def stored_resume(connection: AsyncConnection, me: uuid.UUID) -> Any:
    return (
        await connection.execute(
            still_open(
                select(resume_states),
                resume_states.c.task_id,
                resume_states.c.slide_id,
                me,
            ).where(
                resume_states.c.tenant_id == literal_column(CURRENT_TENANT),
                resume_states.c.user_id == me,
            )
        )
    ).one_or_none()


async def resume_of(
    connection: AsyncConnection, me: uuid.UUID, tasks: list[MyTask]
) -> ResumeTarget | None:
    by_id = {task.id: task for task in tasks}
    last = await last_activity(connection, me)
    stored = await stored_resume(connection, me)
    mode, camera = ResumeMode.GUIDED, None
    object_id: str | None
    if (
        stored is not None
        and stored.task_id in by_id
        and (last is None or last.task_id not in by_id or stored.updated_at > last.at)
    ):
        task, slide_id, object_id = by_id[stored.task_id], stored.slide_id, stored.object_id
        mode = ResumeMode(stored.mode)
        camera = None if stored.camera is None else ResumeCamera.model_validate(stored.camera)
    elif last is not None and last.task_id in by_id:
        task, slide_id = by_id[last.task_id], last.slide_id
        object_id = ObjectId(LETTERS[last.kind], last.number, person=last.person).text(ascii=True)
    else:
        task = next((task for task in tasks if task.status in OPEN and task.next_slide_id), None)
        if task is None or task.next_slide_id is None:
            return None
        slide_id, object_id = task.next_slide_id, None
    mine = [
        row.slide_id
        for row in await connection.execute(
            select(review_task_slides.c.slide_id)
            .join(
                review_assignments,
                (review_assignments.c.task_id == review_task_slides.c.task_id)
                & (review_assignments.c.slide_id == review_task_slides.c.slide_id),
            )
            .where(
                review_task_slides.c.task_id == task.id,
                review_assignments.c.user_id == me,
                review_assignments.c.released_at.is_(None),
            )
            .order_by(review_task_slides.c.position)
        )
    ]
    slide = (
        await connection.execute(
            select(slides.c.label, cases.c.label.label("case_label"))
            .outerjoin(cases, cases.c.id == slides.c.case_id)
            .where(slides.c.id == slide_id)
        )
    ).one()
    counted = await connection.scalar(
        select(func.count()).where(
            review_decisions.c.task_id == task.id,
            review_decisions.c.slide_id == slide_id,
            review_decisions.c.user_id == me,
        )
    )
    return ResumeTarget(
        task_id=task.id,
        task_code=task.code,
        task_name=task.name,
        project=task.project,
        slide_id=slide_id,
        slide_label=slide.label,
        case_label=slide.case_label,
        position=mine.index(slide_id) + 1,
        slides_assigned=len(mine),
        object_id=object_id,
        decisions_on_slide=int(counted or 0),
        due_on=task.due_on,
        blinded=task.blinded,
        mode=mode,
        camera=camera,
    )


def reviewed(slide_column: Any) -> Any:
    return exists().where(
        review_assignments.c.slide_id == slide_column,
        review_assignments.c.submitted_at.is_not(None),
    )


async def projects_of(
    connection: AsyncConnection, principal: MemberPrincipal, workspace: Grant
) -> tuple[list[HomeProject], int, list[uuid.UUID]]:
    rows = (
        await connection.execute(
            select(projects, project_members.c.role.label("my_role"))
            .join(project_members, project_members.c.project_id == projects.c.id)
            .where(
                project_members.c.user_id == principal.user_id,
                projects.c.archived_at.is_(None),
                LIVE,
            )
            .order_by(projects.c.number)
        )
    ).all()
    found: list[HomeProject] = []
    without_results = 0
    adjudicated: list[uuid.UUID] = []
    for row in rows:
        role = ProjectRole(row.my_role)
        whole = reads_whole(in_project(workspace, Permission.SEE_SLIDES, role))
        if whole:
            adjudicated.append(row.id)
        visible = [slides.c.project_id == row.id, slides.c.deleted_at.is_(None)]
        if not whole:
            visible.append(slides.c.id.in_(assigned_slides(principal)))
        has_set = exists().where(
            result_sets.c.slide_id == slides.c.id, result_sets.c.deleted_at.is_(None)
        )
        counts = (
            await connection.execute(
                select(
                    func.count(),
                    func.count().filter(reviewed(slides.c.id)),
                    func.count().filter(~has_set),
                ).where(*visible)
            )
        ).one()
        sets = await connection.scalar(
            select(func.count())
            .select_from(result_sets)
            .join(slides, slides.c.id == result_sets.c.slide_id)
            .where(result_sets.c.deleted_at.is_(None), *visible)
        )
        members = await connection.scalar(
            select(func.count()).where(project_members.c.project_id == row.id)
        )
        strip = [
            StripSlide(id=slide.id, label=slide.label, reviewed=slide.reviewed)
            for slide in await connection.execute(
                select(slides.c.id, slides.c.label, reviewed(slides.c.id).label("reviewed"))
                .where(*visible)
                .order_by(slides.c.created_at, slides.c.id)
                .limit(STRIP)
            )
        ]
        without_results += counts[2]
        found.append(
            HomeProject(
                id=row.id,
                code=project_code(row.number),
                name=row.name,
                colour=row.colour,
                privacy_mode=PrivacyMode(row.privacy_mode),
                my_role=role,
                members=int(members or 0),
                slides=counts[0],
                result_sets=int(sets or 0),
                reviewed_slides=counts[1],
                strip=strip,
            )
        )
    return found, without_results, adjudicated


async def week_of(connection: AsyncConnection, me: uuid.UUID, adjudicated: list[uuid.UUID]) -> Week:
    since = (await connection.execute(select(func.now() - WEEK))).scalar_one()
    checked, agreed = (
        await connection.execute(
            select(
                func.count(), func.count().filter(review_decisions.c.value == DecisionValue.AGREE)
            )
            .join(projects, projects.c.id == review_decisions.c.project_id)
            .where(
                review_decisions.c.user_id == me, review_decisions.c.updated_at >= since, NOT_SAMPLE
            )
        )
    ).one()
    open_disagreements: int | None = None
    if adjudicated:
        open_disagreements = 0
        for task_id in await connection.scalars(
            select(review_tasks.c.id).where(
                review_tasks.c.project_id.in_(adjudicated),
                review_tasks.c.archived_at.is_(None),
                review_tasks.c.signed_off_at.is_(None),
            )
        ):
            open_disagreements += open_count(await queue_of(connection, task_id))
    return Week(
        since=since,
        objects_checked=checked,
        agreed=agreed,
        agree_share=agreed / checked if checked else None,
        open_disagreements=open_disagreements,
    )


@router.get("/home", operation_id="getMyHome")
async def get_my_home(principal: CurrentPrincipal, connection: TenantConnection) -> Home:
    person = member_of(principal)
    workspace = grant_of(person, Permission.SEE_SLIDES)
    tasks: list[MyTask] = []
    found: list[HomeProject] = []
    without_results = 0
    adjudicated: list[uuid.UUID] = []
    if workspace is not Grant.NONE:
        tasks = await my_review_tasks(connection, person.user_id)
        found, without_results, adjudicated = await projects_of(connection, person, workspace)
    return Home(
        resume=await resume_of(connection, person.user_id, tasks) if tasks else None,
        tasks=open_tasks(tasks),
        projects=found,
        slides_without_results=without_results,
        week=await week_of(connection, person.user_id, adjudicated),
        announcements=await current_announcements(connection),
    )


async def assigned_to_me(
    connection: AsyncConnection, me: uuid.UUID, task_id: uuid.UUID, slide_id: uuid.UUID
) -> bool:
    found = await connection.scalar(
        select(review_assignments.c.task_id)
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == me,
            review_assignments.c.released_at.is_(None),
            review_tasks.c.archived_at.is_(None),
        )
    )
    return found is not None


@router.put("/resume", operation_id="setMyResume")
async def set_my_resume(
    change: ResumeChange, principal: CurrentPrincipal, connection: TenantConnection
) -> ResumeState:
    person = member_of(principal)
    if not await assigned_to_me(connection, person.user_id, change.task_id, change.slide_id):
        raise NotFoundError("Task slide not found")
    values = {
        "task_id": change.task_id,
        "slide_id": change.slide_id,
        "mode": change.mode.value,
        "object_id": change.object_id,
        "camera": None if change.camera is None else change.camera.model_dump(),
    }
    updated_at = (
        await connection.execute(
            upsert(resume_states)
            .values(tenant_id=person.tenant_id, user_id=person.user_id, **values)
            .on_conflict_do_update(
                index_elements=[resume_states.c.tenant_id, resume_states.c.user_id],
                set_=values,
            )
            .returning(resume_states.c.updated_at)
        )
    ).scalar_one()
    return ResumeState(**change.model_dump(), updated_at=updated_at)
