import secrets
import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import FirstReadStartedError, task_started
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.project_access import project_grant, reads_whole
from parfocal_api.projects import ProjectArchivedError, owned, visible
from parfocal_api.review_order import Results, store_order, stored_seeds
from parfocal_api.tables import (
    ProjectRole,
    ResultStatus,
    StartMode,
    TaskScope,
    TaskSplit,
    cases,
    opinion_forms,
    project_members,
    result_sets,
    review_assignments,
    review_task_slides,
    review_tasks,
    slides,
)
from parfocal_common.scope import Scope as SamplingScope
from parfocal_common.scope import ScopeKind

MAX_SLIDES = 500
MAX_REVIEWERS = 50
SCORE_STEPS = 255
REVIEWING_ROLES = frozenset({ProjectRole.OWNER, ProjectRole.REVIEWER})

type TaskName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
type Reminders = Annotated[list[Annotated[int, Field(ge=0, le=60)]], Field(max_length=3)]


class Scope(BaseModel):
    kind: TaskScope
    count: Annotated[int, Field(ge=1, le=10_000)] | None = None
    score: Annotated[float, Field(ge=0, le=1)] | None = None

    @model_validator(mode="after")
    def parameters_fit(self) -> Scope:
        if (self.kind is TaskScope.RANDOM_CELLS) != (self.count is not None):
            raise ValueError("A random sample of cells needs a count, and only it has one")
        if (self.kind is TaskScope.CELLS_BELOW_SCORE) != (self.score is not None):
            raise ValueError("Cells below a score need a score, and only they have one")
        return self


class SlideSet(BaseModel):
    slide_id: uuid.UUID
    result_set_id: uuid.UUID


class Pair(BaseModel):
    slide_id: uuid.UUID
    user_id: uuid.UUID


class TaskDraft(BaseModel):
    name: TaskName
    slide_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_SLIDES)] = []
    case_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_SLIDES)] = []
    result_sets: Annotated[list[SlideSet], Field(max_length=MAX_SLIDES)] = []
    model_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
        | None
    ) = None
    reviewer_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_REVIEWERS)]
    split: TaskSplit
    pairs: Annotated[list[Pair], Field(max_length=MAX_SLIDES * MAX_REVIEWERS)] = []
    scope: Scope
    opinion_form_version: Annotated[int, Field(ge=1)] | None = None
    blinded: bool = True
    ai_hidden_first_read: bool = False
    start_mode: StartMode = StartMode.GUIDED
    due_on: date | None = None
    reminder_days: Reminders = []

    @model_validator(mode="after")
    def consistent(self) -> TaskDraft:
        if not self.slide_ids and not self.case_ids:
            raise ValueError("Name slides or cases")
        if (self.model_name is None) == (not self.result_sets):
            raise ValueError("Pick a result set per slide or a model name, not both")
        if len(set(self.reviewer_ids)) != len(self.reviewer_ids):
            raise ValueError("A reviewer appears twice")
        if (self.split is TaskSplit.CHOSEN) != bool(self.pairs):
            raise ValueError("Only a chosen split lists slide and reviewer pairs, and it must")
        return self


class TaskChange(BaseModel):
    name: TaskName | None = None
    scope: Scope | None = None
    blinded: bool | None = None
    ai_hidden_first_read: bool | None = None
    start_mode: StartMode | None = None
    due_on: date | None = None
    reminder_days: Reminders | None = None

    @model_validator(mode="after")
    def has_change(self) -> TaskChange:
        if not self.model_fields_set:
            raise ValueError("Change at least one thing")
        return self


class TaskSlide(BaseModel):
    slide_id: uuid.UUID
    result_set_id: uuid.UUID
    reviewer_ids: list[uuid.UUID]


class ReviewTask(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    number: int
    code: str
    name: str
    split: TaskSplit
    scope: Scope
    opinion_form_version: int
    blinded: bool
    ai_hidden_first_read: bool
    start_mode: StartMode
    due_on: date | None
    reminder_days: list[int]
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    slide_count: int
    reviewer_count: int


class ReviewTaskDetail(ReviewTask):
    slides: list[TaskSlide]


class TaskNeedsSlidesError(BadRequestError):
    code = "task-needs-slides"
    title = "A task needs at least one slide of this project"


class UnknownSlideError(BadRequestError):
    code = "unknown-slide"
    title = "A slide or case is not in this project"


class NoResultSetError(BadRequestError):
    code = "no-result-set"
    title = "A slide has no finished result set to review"


class NotAReviewerError(BadRequestError):
    code = "not-a-project-reviewer"
    title = "Every reviewer must be an owner or reviewer of this project"


class BadPairsError(BadRequestError):
    code = "bad-pairs"
    title = "Each pair needs a task slide and a task reviewer, and every slide a reviewer"


class UnknownFormVersionError(BadRequestError):
    code = "unknown-opinion-form-version"
    title = "This project has no such opinion form version"


project_router = APIRouter(prefix="/api/projects/{project_id}/review-tasks", tags=["review-tasks"])
router = APIRouter(prefix="/api/review-tasks", tags=["review-tasks"])


def own_assignments(principal: Principal) -> ColumnElement[bool]:
    user_id = principal.user_id if isinstance(principal, MemberPrincipal) else None
    return review_assignments.c.user_id == user_id


def code_of(number: int) -> str:
    return f"RT-{number}"


def stored_score(score: float) -> int:
    return round(score * SCORE_STEPS)


def sampling_scope(row: Any) -> SamplingScope:
    return SamplingScope(
        ScopeKind(row.scope), count=row.scope_count, seed=row.scope_seed, score=row.scope_score
    )


async def task_sets(connection: AsyncConnection, task_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    rows = await connection.execute(
        select(review_task_slides.c.slide_id, review_task_slides.c.result_set_id).where(
            review_task_slides.c.task_id == task_id
        )
    )
    return {row[0]: row[1] for row in rows}


def scope_of(row: Any) -> Scope:
    score = None if row.scope_score is None else round(row.scope_score / SCORE_STEPS, 3)
    return Scope(kind=TaskScope(row.scope), count=row.scope_count, score=score)


async def task_slides_of(
    connection: AsyncConnection, principal: Principal, row: Any, whole: bool
) -> list[TaskSlide]:
    statement = select(review_task_slides).where(review_task_slides.c.task_id == row.id)
    if not whole:
        statement = statement.where(
            review_task_slides.c.slide_id.in_(
                select(review_assignments.c.slide_id).where(
                    review_assignments.c.task_id == row.id, own_assignments(principal)
                )
            )
        )
    slide_rows = (await connection.execute(statement.order_by(review_task_slides.c.position))).all()
    reviewers: dict[uuid.UUID, list[uuid.UUID]] = {}
    for slide_id, user_id in await connection.execute(
        select(review_assignments.c.slide_id, review_assignments.c.user_id)
        .where(review_assignments.c.task_id == row.id)
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    ):
        reviewers.setdefault(slide_id, []).append(user_id)
    return [
        TaskSlide(
            slide_id=slide.slide_id,
            result_set_id=slide.result_set_id,
            reviewer_ids=reviewers.get(slide.slide_id, []),
        )
        for slide in slide_rows
    ]


def task_of(row: Any, slide_count: int, reviewer_count: int) -> ReviewTask:
    return ReviewTask(
        id=row.id,
        project_id=row.project_id,
        number=row.number,
        code=code_of(row.number),
        name=row.name,
        split=TaskSplit(row.split),
        scope=scope_of(row),
        opinion_form_version=row.opinion_form_version,
        blinded=row.blinded,
        ai_hidden_first_read=row.ai_hidden_first_read,
        start_mode=StartMode(row.start_mode),
        due_on=row.due_on,
        reminder_days=list(row.reminder_days),
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        slide_count=slide_count,
        reviewer_count=reviewer_count,
    )


async def detail_of(
    connection: AsyncConnection, principal: Principal, row: Any, whole: bool
) -> ReviewTaskDetail:
    task_slides = await task_slides_of(connection, principal, row, whole)
    people = {user for slide in task_slides for user in slide.reviewer_ids}
    return ReviewTaskDetail(
        **task_of(row, len(task_slides), len(people)).model_dump(), slides=task_slides
    )


async def slides_named(
    connection: AsyncConnection, project_id: uuid.UUID, draft: TaskDraft
) -> list[Any]:
    wanted = list(dict.fromkeys(draft.slide_ids))
    chosen = {
        row.id: row
        for row in await connection.execute(
            select(slides.c.id, slides.c.label, slides.c.case_id).where(
                slides.c.project_id == project_id,
                slides.c.deleted_at.is_(None),
                slides.c.id.in_(wanted),
            )
        )
    }
    if len(chosen) != len(wanted):
        raise UnknownSlideError
    ordered = [chosen[slide_id] for slide_id in wanted]
    if draft.case_ids:
        found_cases = set(
            await connection.scalars(
                select(cases.c.id).where(
                    cases.c.project_id == project_id,
                    cases.c.deleted_at.is_(None),
                    cases.c.id.in_(draft.case_ids),
                )
            )
        )
        if found_cases != set(draft.case_ids):
            raise UnknownSlideError
        for case_id in dict.fromkeys(draft.case_ids):
            ordered.extend(
                await connection.execute(
                    select(slides.c.id, slides.c.label, slides.c.case_id)
                    .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
                    .order_by(slides.c.created_at, slides.c.label)
                )
            )
    unique = list({row.id: row for row in ordered}.values())
    if not unique:
        raise TaskNeedsSlidesError
    return unique


async def sets_for(
    connection: AsyncConnection, task_slides: Sequence[Any], draft: TaskDraft
) -> dict[uuid.UUID, uuid.UUID]:
    usable = (
        select(result_sets.c.id, result_sets.c.slide_id, result_sets.c.name)
        .where(
            result_sets.c.slide_id.in_([slide.id for slide in task_slides]),
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.deleted_at.is_(None),
        )
        .order_by(result_sets.c.created_at)
    )
    rows = (await connection.execute(usable)).all()
    picked: dict[uuid.UUID, uuid.UUID] = {}
    if draft.model_name is not None:
        for row in rows:
            if row.name.casefold() == draft.model_name.casefold():
                picked[row.slide_id] = row.id
    else:
        valid = {(row.slide_id, row.id) for row in rows}
        for choice in draft.result_sets:
            if (choice.slide_id, choice.result_set_id) in valid:
                picked[choice.slide_id] = choice.result_set_id
    missing = [slide.label for slide in task_slides if slide.id not in picked]
    if missing:
        raise NoResultSetError(f"No finished result set for {', '.join(missing[:5])}")
    return picked


async def check_reviewers(
    connection: AsyncConnection, project_id: uuid.UUID, reviewer_ids: Sequence[uuid.UUID]
) -> None:
    members = set(
        await connection.scalars(
            select(project_members.c.user_id).where(
                project_members.c.project_id == project_id,
                project_members.c.user_id.in_(reviewer_ids),
                project_members.c.role.in_(REVIEWING_ROLES),
            )
        )
    )
    if members != set(reviewer_ids):
        raise NotAReviewerError


def assignments_for(
    draft: TaskDraft, slide_ids: Sequence[uuid.UUID]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    reviewers = draft.reviewer_ids
    match draft.split:
        case TaskSplit.EVERYONE:
            return [(slide, person) for slide in slide_ids for person in reviewers]
        case TaskSplit.EVEN:
            return [
                (slide, reviewers[index % len(reviewers)]) for index, slide in enumerate(slide_ids)
            ]
        case TaskSplit.CHOSEN:
            pairs = list(dict.fromkeys((pair.slide_id, pair.user_id) for pair in draft.pairs))
            known_slides, known_people = set(slide_ids), set(reviewers)
            if any(
                slide not in known_slides or person not in known_people for slide, person in pairs
            ):
                raise BadPairsError
            if {slide for slide, _ in pairs} != known_slides:
                raise BadPairsError
            order = {slide: index for index, slide in enumerate(slide_ids)}
            return sorted(pairs, key=lambda pair: (order[pair[0]], reviewers.index(pair[1])))


async def form_version(
    connection: AsyncConnection, project_id: uuid.UUID, wanted: int | None
) -> int:
    statement = select(func.max(opinion_forms.c.version)).where(
        opinion_forms.c.project_id == project_id
    )
    if wanted is not None:
        statement = statement.where(opinion_forms.c.version == wanted)
    version = await connection.scalar(statement)
    if version is None:
        raise UnknownFormVersionError
    return int(version)


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    tenant_id: uuid.UUID,
    task_id: uuid.UUID,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=tenant_id,
        details=details,
    )


async def task_row(connection: AsyncConnection, task_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(review_tasks).where(
                review_tasks.c.id == task_id, review_tasks.c.archived_at.is_(None)
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Review task not found")
    return row


async def readable_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID
) -> tuple[Any, bool]:
    row = await task_row(connection, task_id)
    await visible(connection, principal, row.project_id)
    whole = reads_whole(
        await project_grant(connection, principal, row.project_id, Permission.SEE_SLIDES)
    )
    if not whole:
        mine = select(review_assignments.c.slide_id).where(
            review_assignments.c.task_id == task_id, own_assignments(principal)
        )
        if not await connection.scalar(select(mine.exists())):
            raise NotFoundError("Review task not found")
    return row, whole


@project_router.post(
    "",
    operation_id="createReviewTask",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def create_review_task(
    project_id: uuid.UUID,
    draft: TaskDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> ReviewTaskDetail:
    project = await owned(connection, principal, project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    task_slides = await slides_named(connection, project_id, draft)
    picked = await sets_for(connection, task_slides, draft)
    await check_reviewers(connection, project_id, draft.reviewer_ids)
    slide_ids = [slide.id for slide in task_slides]
    pairs = assignments_for(draft, slide_ids)
    version = await form_version(connection, project_id, draft.opinion_form_version)
    number = select(func.coalesce(func.max(review_tasks.c.number), 0) + 1).where(
        review_tasks.c.project_id == project_id
    )
    scope = draft.scope
    seed = secrets.randbits(62)
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=project.tenant_id,
            project_id=project_id,
            number=number.scalar_subquery(),
            name=draft.name,
            split=draft.split,
            scope=scope.kind,
            scope_count=scope.count,
            scope_seed=seed if scope.kind is TaskScope.RANDOM_CELLS else None,
            scope_score=None if scope.score is None else stored_score(scope.score),
            opinion_form_version=version,
            blinded=draft.blinded,
            ai_hidden_first_read=draft.ai_hidden_first_read,
            start_mode=draft.start_mode,
            due_on=draft.due_on,
            reminder_days=sorted(set(draft.reminder_days), reverse=True),
            created_by_user_id=(
                principal.user_id if isinstance(principal, MemberPrincipal) else None
            ),
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides),
        [
            {
                "tenant_id": project.tenant_id,
                "project_id": project_id,
                "task_id": task_id,
                "slide_id": slide_id,
                "position": position,
                "result_set_id": picked[slide_id],
            }
            for position, slide_id in enumerate(slide_ids)
        ],
    )
    await connection.execute(
        insert(review_assignments),
        [
            {"tenant_id": project.tenant_id, "task_id": task_id, "slide_id": slide, "user_id": user}
            for slide, user in pairs
        ],
    )
    await store_order(
        connection,
        results,
        project.tenant_id,
        project_id,
        task_id,
        sampling_scope(await task_row(connection, task_id)),
        {slide_id: picked[slide_id] for slide_id in slide_ids},
        dict.fromkeys(slide_ids, seed),
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_CREATED,
        project.tenant_id,
        task_id,
        {
            "project_id": str(project_id),
            "slides": len(slide_ids),
            "reviewers": len(draft.reviewer_ids),
            "split": draft.split.value,
        },
    )
    return await detail_of(connection, principal, await task_row(connection, task_id), True)


@project_router.get(
    "", operation_id="listReviewTasks", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_review_tasks(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ReviewTask]:
    await visible(connection, principal, project_id)
    whole = reads_whole(
        await project_grant(connection, principal, project_id, Permission.SEE_SLIDES)
    )
    statement = select(review_tasks).where(
        review_tasks.c.project_id == project_id, review_tasks.c.archived_at.is_(None)
    )
    if not whole:
        mine = select(review_assignments.c.task_id).where(own_assignments(principal))
        statement = statement.where(review_tasks.c.id.in_(mine))
    rows = (await connection.execute(statement.order_by(review_tasks.c.number))).all()
    counts = {
        task_id: (slides_count, people)
        for task_id, slides_count, people in await connection.execute(
            select(
                review_assignments.c.task_id,
                func.count(func.distinct(review_assignments.c.slide_id)),
                func.count(func.distinct(review_assignments.c.user_id)),
            )
            .where(review_assignments.c.task_id.in_([row.id for row in rows]))
            .group_by(review_assignments.c.task_id)
        )
    }
    return [task_of(row, *counts.get(row.id, (0, 0))) for row in rows]


@router.get(
    "/{task_id}", operation_id="getReviewTask", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_review_task(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ReviewTaskDetail:
    row, whole = await readable_task(connection, principal, task_id)
    return await detail_of(connection, principal, row, whole)


@router.patch(
    "/{task_id}", operation_id="changeReviewTask", **require(Permission.CREATE_CASES, write=True)
)
async def change_review_task(
    task_id: uuid.UUID,
    change: TaskChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> ReviewTaskDetail:
    row = await task_row(connection, task_id)
    project = await owned(connection, principal, row.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    values: dict[str, Any] = {}
    for field in ("name", "blinded", "ai_hidden_first_read", "start_mode", "due_on"):
        if field in change.model_fields_set:
            value = getattr(change, field)
            if value is None and field != "due_on":
                raise BadRequestError(f"{field} cannot be empty")
            values[field] = value
    switching = values.get("ai_hidden_first_read", row.ai_hidden_first_read)
    if switching != row.ai_hidden_first_read and await task_started(connection, task_id):
        raise FirstReadStartedError
    if "reminder_days" in change.model_fields_set:
        values["reminder_days"] = sorted(set(change.reminder_days or []), reverse=True)
    rescoped = change.scope is not None and (
        change.scope.kind,
        change.scope.count,
        None if change.scope.score is None else stored_score(change.scope.score),
    ) != (TaskScope(row.scope), row.scope_count, row.scope_score)
    if change.scope is not None:
        scope = change.scope
        values |= {
            "scope": scope.kind,
            "scope_count": scope.count,
            "scope_seed": row.scope_seed
            if scope.kind is TaskScope.RANDOM_CELLS and row.scope_seed is not None
            else secrets.randbits(62)
            if scope.kind is TaskScope.RANDOM_CELLS
            else None,
            "scope_score": None if scope.score is None else stored_score(scope.score),
        }
    await connection.execute(
        update(review_tasks).where(review_tasks.c.id == task_id).values(**values)
    )
    if rescoped:
        changed = await task_row(connection, task_id)
        sets = await task_sets(connection, task_id)
        known = await stored_seeds(connection, task_id, list(sets))
        fallback = changed.scope_seed or secrets.randbits(62)
        await store_order(
            connection,
            results,
            row.tenant_id,
            row.project_id,
            task_id,
            sampling_scope(changed),
            sets,
            {slide_id: known.get(slide_id, fallback) for slide_id in sets},
        )
    await audit(
        connection,
        principal,
        AuditAction.TASK_CHANGED,
        row.tenant_id,
        task_id,
        {"fields": sorted(change.model_fields_set)},
    )
    return await detail_of(connection, principal, await task_row(connection, task_id), True)
