import base64
import json
import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import Select, exists, func, or_, select, tuple_, union
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import queue_of
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.project_access import readable_slide
from parfocal_api.projects import code_of as project_code
from parfocal_api.review_states import State, TaskStates, states_of, states_of_many, tasks_of
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.tables import (
    ProjectRole,
    ResultSource,
    ResultStatus,
    SlideStorage,
    StartMode,
    TaskScope,
    annotations,
    cases,
    opinions,
    project_members,
    projects,
    result_sets,
    review_assignments,
    review_decisions,
    review_edits,
    review_skips,
    review_task_slides,
    review_tasks,
    slides,
)
from parfocal_common.ingest import Notice

PAGE = 50
MAX_PAGE = 200
BATCH = 500


class MyStatus(StrEnum):
    NOT_STARTED = "not-started"
    IN_REVIEW = "in-review"
    SUBMITTED = "submitted"
    SIGNED_OFF = "signed-off"


class TaskStatus(StrEnum):
    NOT_STARTED = "not-started"
    IN_REVIEW = "in-review"
    DISAGREEMENTS = "disagreements"
    READY_TO_SIGN_OFF = "ready-to-sign-off"
    SIGNED_OFF = "signed-off"


MY_ORDER = [MyStatus.IN_REVIEW, MyStatus.NOT_STARTED, MyStatus.SUBMITTED, MyStatus.SIGNED_OFF]


class ProjectRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class MyTask(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    project: ProjectRef
    scope: TaskScope
    due_on: date | None
    blinded: bool
    start_mode: StartMode
    slides_submitted: int
    slides_assigned: int
    decisions: int
    status: MyStatus
    next_slide_id: uuid.UUID | None
    created_by_user_id: uuid.UUID | None


class ReviewerProgress(BaseModel):
    user_id: uuid.UUID
    slides_submitted: int
    slides_assigned: int
    state: MyStatus


class AssignedTask(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    project: ProjectRef
    due_on: date | None
    status: TaskStatus
    open_disagreements: int
    reviewers: list[ReviewerProgress]


class SlideReview(BaseModel):
    task_id: uuid.UUID
    task_code: str
    user_id: uuid.UUID
    state: State


class SetRef(BaseModel):
    id: uuid.UUID
    name: str
    status: ResultStatus


class SlideRow(BaseModel):
    id: uuid.UUID
    label: str
    project: ProjectRef
    case_id: uuid.UUID | None
    case_label: str | None
    result_sets: list[SetRef]
    reviews: list[SlideReview]
    status: State
    storage: SlideStorage
    created_at: datetime
    high_power_unreadable: bool = False


class SlidePage(BaseModel):
    slides: list[SlideRow]
    next_cursor: str | None


class BadCursorError(BadRequestError):
    code = "bad-cursor"
    title = "The page cursor is not valid"


router = APIRouter(prefix="/api/me", tags=["me"])


def project_ref(row: Any) -> ProjectRef:
    return ProjectRef(
        id=row.project_id, code=project_code(row.project_number), name=row.project_name
    )


def reviewer_status(submitted: int, assigned: int, worked: bool, signed_off: bool) -> MyStatus:
    if signed_off:
        return MyStatus.SIGNED_OFF
    if assigned and submitted == assigned:
        return MyStatus.SUBMITTED
    return MyStatus.IN_REVIEW if worked or submitted else MyStatus.NOT_STARTED


TASK_COLUMNS = (
    review_tasks,
    projects.c.number.label("project_number"),
    projects.c.name.label("project_name"),
)


def worked_on(states: TaskStates, user_id: uuid.UUID) -> bool:
    return any(
        reviewer.user_id == user_id and reviewer.state is State.IN_REVIEW
        for slide in states.slides
        for reviewer in slide.reviewers
    )


async def my_assignments(
    connection: AsyncConnection, me: uuid.UUID, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, bool, bool]]]:
    worked = union(
        *(
            select(table.c.task_id, table.c.slide_id).where(
                user_column == me, table.c.task_id.in_(task_ids)
            )
            for table, user_column in (
                (review_edits, review_edits.c.user_id),
                (annotations, annotations.c.created_by_user_id),
                (review_decisions, review_decisions.c.user_id),
                (review_skips, review_skips.c.user_id),
                (opinions, opinions.c.user_id),
            )
        )
    ).subquery()
    has_work = (
        select(worked.c.slide_id)
        .where(
            worked.c.task_id == review_assignments.c.task_id,
            worked.c.slide_id == review_assignments.c.slide_id,
        )
        .exists()
    )
    found: dict[uuid.UUID, list[tuple[uuid.UUID, bool, bool]]] = {}
    for row in await connection.execute(
        select(
            review_assignments.c.task_id,
            review_assignments.c.slide_id,
            review_assignments.c.submitted_at.is_not(None).label("submitted"),
            has_work.label("has_work"),
        )
        .join(
            review_task_slides,
            (review_task_slides.c.task_id == review_assignments.c.task_id)
            & (review_task_slides.c.slide_id == review_assignments.c.slide_id),
        )
        .where(
            review_assignments.c.user_id == me,
            review_assignments.c.released_at.is_(None),
            review_assignments.c.task_id.in_(task_ids),
        )
        .order_by(review_assignments.c.task_id, review_task_slides.c.position)
    ):
        found.setdefault(row.task_id, []).append((row.slide_id, row.submitted, row.has_work))
    return found


type Assigned = dict[uuid.UUID, list[tuple[uuid.UUID, bool, bool]]]


async def my_review_tasks(connection: AsyncConnection, me: uuid.UUID) -> list[MyTask]:
    return (await my_review_tasks_with_slides(connection, me))[0]


async def my_review_tasks_with_slides(
    connection: AsyncConnection, me: uuid.UUID
) -> tuple[list[MyTask], Assigned]:
    my_decisions = (
        select(func.count())
        .where(review_decisions.c.task_id == review_tasks.c.id, review_decisions.c.user_id == me)
        .scalar_subquery()
        .label("my_decisions")
    )
    rows = (
        await connection.execute(
            select(*TASK_COLUMNS, my_decisions)
            .join(projects, projects.c.id == review_tasks.c.project_id)
            .where(
                review_tasks.c.archived_at.is_(None),
                projects.c.deleted_at.is_(None),
                review_tasks.c.id.in_(
                    select(review_assignments.c.task_id).where(
                        review_assignments.c.user_id == me,
                        review_assignments.c.released_at.is_(None),
                    )
                ),
            )
        )
    ).all()
    if not rows:
        return [], {}
    assigned = await my_assignments(connection, me, [row.id for row in rows])
    tasks: list[MyTask] = []
    for row in rows:
        mine = [(slide, done) for slide, done, _ in assigned.get(row.id, [])]
        worked = any(work and not done for _, done, work in assigned.get(row.id, []))
        submitted = sum(done for _, done in mine)
        status = reviewer_status(
            submitted,
            len(mine),
            worked or row.my_decisions > 0,
            row.signed_off_at is not None,
        )
        tasks.append(
            MyTask(
                id=row.id,
                code=task_code(row.number),
                name=row.name,
                project=project_ref(row),
                scope=TaskScope(row.scope),
                due_on=row.due_on,
                blinded=row.blinded,
                start_mode=StartMode(row.start_mode),
                slides_submitted=submitted,
                slides_assigned=len(mine),
                decisions=int(row.my_decisions),
                status=status,
                next_slide_id=next((slide for slide, done in mine if not done), None),
                created_by_user_id=row.created_by_user_id,
            )
        )
    ordered = sorted(
        tasks,
        key=lambda task: (MY_ORDER.index(task.status), task.due_on or date.max, task.code),
    )
    return ordered, assigned


@router.get("/review-tasks", operation_id="listMyReviewTasks", **require(Permission.SEE_SLIDES))
async def list_my_review_tasks(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[MyTask]:
    return await my_review_tasks(connection, member_of(principal).user_id)


@router.get(
    "/assigned-tasks", operation_id="listTasksAssignedByMe", **require(Permission.SEE_SLIDES)
)
async def list_tasks_assigned_by_me(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[AssignedTask]:
    me = member_of(principal).user_id
    rows = (
        await connection.execute(
            select(*TASK_COLUMNS)
            .join(projects, projects.c.id == review_tasks.c.project_id)
            .join(project_members, project_members.c.project_id == projects.c.id)
            .where(
                review_tasks.c.archived_at.is_(None),
                projects.c.deleted_at.is_(None),
                project_members.c.user_id == me,
                project_members.c.role == ProjectRole.OWNER,
            )
            .order_by(review_tasks.c.created_at.desc())
        )
    ).all()
    result: list[AssignedTask] = []
    for row in rows:
        states = await states_of(connection, row)
        queue = len(await queue_of(connection, row.id))
        signed = row.signed_off_at is not None
        people: dict[uuid.UUID, list[bool]] = {}
        for slide in states.slides:
            for reviewer in slide.reviewers:
                people.setdefault(reviewer.user_id, []).append(reviewer.submitted_at is not None)
        progress = [
            ReviewerProgress(
                user_id=user,
                slides_submitted=sum(done),
                slides_assigned=len(done),
                state=reviewer_status(sum(done), len(done), worked_on(states, user), signed),
            )
            for user, done in people.items()
        ]
        everyone_done = all(item.state is MyStatus.SUBMITTED for item in progress)
        if signed:
            status = TaskStatus.SIGNED_OFF
        elif progress and everyone_done:
            status = TaskStatus.DISAGREEMENTS if queue else TaskStatus.READY_TO_SIGN_OFF
        elif any(item.state is not MyStatus.NOT_STARTED for item in progress):
            status = TaskStatus.IN_REVIEW
        else:
            status = TaskStatus.NOT_STARTED
        result.append(
            AssignedTask(
                id=row.id,
                code=task_code(row.number),
                name=row.name,
                project=project_ref(row),
                due_on=row.due_on,
                status=status,
                open_disagreements=queue,
                reviewers=progress,
            )
        )
    return result


def encode_cursor(created_at: datetime, slide_id: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(slide_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created_at, slide_id = json.loads(
            base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        )
        return datetime.fromisoformat(created_at), uuid.UUID(slide_id)
    except (ValueError, TypeError) as error:
        raise BadCursorError from error


def without_tasks(sets: list[SetRef], sources: dict[uuid.UUID, ResultSource]) -> State:
    if any(item.status is ResultStatus.READY for item in sets):
        return State.READY
    if any(
        item.status is ResultStatus.IMPORTING and sources[item.id] is ResultSource.RUN
        for item in sets
    ):
        return State.AI_RUNNING
    return State.UPLOADED


async def describe(
    connection: AsyncConnection, rows: list[Any], cache: dict[uuid.UUID, TaskStates]
) -> list[SlideRow]:
    ids = [row.id for row in rows]
    sets: dict[uuid.UUID, list[SetRef]] = {}
    sources: dict[uuid.UUID, ResultSource] = {}
    for item in await connection.execute(
        select(
            result_sets.c.id,
            result_sets.c.slide_id,
            result_sets.c.name,
            result_sets.c.status,
            result_sets.c.source,
        )
        .where(result_sets.c.slide_id.in_(ids), result_sets.c.deleted_at.is_(None))
        .order_by(result_sets.c.created_at)
    ):
        sets.setdefault(item.slide_id, []).append(
            SetRef(id=item.id, name=item.name, status=ResultStatus(item.status))
        )
        sources[item.id] = ResultSource(item.source)
    tasks_by_slide: dict[uuid.UUID, list[Any]] = {}
    for item in await connection.execute(
        select(review_task_slides.c.slide_id, review_tasks.c.id, review_tasks.c.number)
        .join(review_tasks, review_tasks.c.id == review_task_slides.c.task_id)
        .where(review_task_slides.c.slide_id.in_(ids), review_tasks.c.archived_at.is_(None))
        .order_by(review_tasks.c.created_at)
    ):
        tasks_by_slide.setdefault(item.slide_id, []).append(item)
    wanted = list(
        {task.id for found in tasks_by_slide.values() for task in found}.difference(cache)
    )
    if wanted:
        cache.update(await states_of_many(connection, await tasks_of(connection, wanted)))
    described: list[SlideRow] = []
    for row in rows:
        reviews: list[SlideReview] = []
        status = without_tasks(sets.get(row.id, []), sources)
        for task in tasks_by_slide.get(row.id, []):
            if task.id not in cache:
                continue
            for slide in cache[task.id].slides:
                if slide.slide_id != row.id:
                    continue
                status = slide.state
                reviews.extend(
                    SlideReview(
                        task_id=task.id,
                        task_code=task_code(task.number),
                        user_id=reviewer.user_id,
                        state=reviewer.state,
                    )
                    for reviewer in slide.reviewers
                )
        described.append(
            SlideRow(
                id=row.id,
                label=row.label,
                project=project_ref(row),
                case_id=row.case_id,
                case_label=row.case_label,
                result_sets=sets.get(row.id, []),
                reviews=reviews,
                status=status,
                storage=SlideStorage(row.storage),
                created_at=row.created_at,
                high_power_unreadable=Notice.HIGH_POWER_UNREADABLE in row.notices,
            )
        )
    return described


def slides_statement(
    principal: CurrentPrincipal,
    project_id: uuid.UUID | None,
    result_set: str | None,
    reviewer_id: uuid.UUID | None,
    storage: SlideStorage | None,
    q: str | None,
) -> Select[*tuple[Any, ...]]:
    statement = (
        select(
            slides.c.id,
            slides.c.label,
            slides.c.case_id,
            slides.c.created_at,
            slides.c.storage,
            slides.c.notices,
            slides.c.project_id,
            projects.c.number.label("project_number"),
            projects.c.name.label("project_name"),
            cases.c.label.label("case_label"),
        )
        .join(projects, projects.c.id == slides.c.project_id)
        .outerjoin(cases, cases.c.id == slides.c.case_id)
        .where(
            slides.c.deleted_at.is_(None),
            readable_slide(principal, slides.c.project_id, slides.c.id),
        )
        .order_by(slides.c.created_at.desc(), slides.c.id.desc())
    )
    if project_id is not None:
        statement = statement.where(slides.c.project_id == project_id)
    if result_set is not None:
        statement = statement.where(
            exists().where(
                result_sets.c.slide_id == slides.c.id,
                result_sets.c.deleted_at.is_(None),
                func.lower(result_sets.c.name) == result_set.lower(),
            )
        )
    if storage is not None:
        statement = statement.where(slides.c.storage == storage)
    if reviewer_id is not None:
        statement = statement.where(
            exists().where(
                review_assignments.c.slide_id == slides.c.id,
                review_assignments.c.user_id == reviewer_id,
                review_assignments.c.released_at.is_(None),
            )
        )
    if q:
        pattern = f"%{q.replace('%', r'\%').replace('_', r'\_')}%"
        statement = statement.where(
            or_(slides.c.label.ilike(pattern), cases.c.label.ilike(pattern))
        )
    return statement


@router.get("/slides", operation_id="listMySlides", **require(Permission.SEE_SLIDES))
async def list_my_slides(
    principal: CurrentPrincipal,
    connection: TenantConnection,
    project_id: uuid.UUID | None = None,
    status: State | None = None,
    result_set: Annotated[str | None, Query(max_length=120)] = None,
    reviewer_id: uuid.UUID | None = None,
    storage: SlideStorage | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = PAGE,
) -> SlidePage:
    member_of(principal)
    statement = slides_statement(principal, project_id, result_set, reviewer_id, storage, q)
    after = decode_cursor(cursor) if cursor else None
    found: list[SlideRow] = []
    cache: dict[uuid.UUID, TaskStates] = {}
    last_seen: tuple[datetime, uuid.UUID] | None = after
    more = True
    while len(found) <= limit and more:
        batch = statement
        if last_seen is not None:
            batch = batch.where(tuple_(slides.c.created_at, slides.c.id) < tuple_(*last_seen))
        rows = (await connection.execute(batch.limit(BATCH))).all()
        more = len(rows) == BATCH
        for row in await describe(connection, list(rows), cache):
            last_seen = (row.created_at, row.id)
            if status is None or row.status is status:
                found.append(row)
            if len(found) > limit:
                break
        if not rows:
            more = False
    page = found[:limit]
    next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if len(found) > limit else None
    return SlidePage(slides=page, next_cursor=next_cursor)
