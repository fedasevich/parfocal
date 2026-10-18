import uuid
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import exists, func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.announcements import Announcement, current_announcements
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import open_count, queue_of
from parfocal_api.my_work import MyStatus, MyTask, ProjectRef, my_review_tasks
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Grant, Permission, grant_of, in_project
from parfocal_api.principals import MemberPrincipal
from parfocal_api.project_access import assigned_slides, reads_whole
from parfocal_api.projects import code_of as project_code
from parfocal_api.reviewed_export import LETTERS
from parfocal_api.tables import (
    PrivacyMode,
    ProjectRole,
    VerdictValue,
    annotations,
    cases,
    project_members,
    projects,
    result_sets,
    review_assignments,
    review_edits,
    review_task_slides,
    review_tasks,
    slides,
    verdicts,
)
from parfocal_common.object_ids import ObjectId

STRIP = 4
WEEK = timedelta(days=7)
OPEN = (MyStatus.IN_REVIEW, MyStatus.NOT_STARTED)


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
    verdicts_on_slide: int
    due_on: date | None
    blinded: bool
    camera: dict[str, float] | None


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
            verdicts.c.task_id,
            verdicts.c.slide_id,
            verdicts.c.kind,
            verdicts.c.number,
            literal(False).label("person"),
            verdicts.c.updated_at.label("at"),
        ).where(verdicts.c.user_id == me),
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
            select(touched)
            .join(
                review_assignments,
                (review_assignments.c.task_id == touched.c.task_id)
                & (review_assignments.c.slide_id == touched.c.slide_id)
                & (review_assignments.c.user_id == me),
            )
            .join(review_tasks, review_tasks.c.id == touched.c.task_id)
            .where(
                review_assignments.c.submitted_at.is_(None),
                review_tasks.c.archived_at.is_(None),
                review_tasks.c.signed_off_at.is_(None),
            )
            .order_by(touched.c.at.desc())
            .limit(1)
        )
    ).one_or_none()


async def resume_of(
    connection: AsyncConnection, me: uuid.UUID, tasks: list[MyTask]
) -> ResumeTarget | None:
    by_id = {task.id: task for task in tasks}
    last = await last_activity(connection, me)
    if last is not None and last.task_id in by_id:
        task, slide_id = by_id[last.task_id], last.slide_id
        object_id: str | None = ObjectId(LETTERS[last.kind], last.number, person=last.person).text(
            ascii=True
        )
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
            .where(review_task_slides.c.task_id == task.id, review_assignments.c.user_id == me)
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
            verdicts.c.task_id == task.id, verdicts.c.slide_id == slide_id, verdicts.c.user_id == me
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
        verdicts_on_slide=int(counted or 0),
        due_on=task.due_on,
        blinded=task.blinded,
        camera=None,
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
            select(func.count(), func.count().filter(verdicts.c.value == VerdictValue.AGREE)).where(
                verdicts.c.user_id == me, verdicts.c.updated_at >= since
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
