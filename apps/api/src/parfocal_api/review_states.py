import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import first_read_open
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import open_by_slide, open_count, queue_of
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError, ProblemError
from parfocal_api.project_access import role_in
from parfocal_api.projects import ProjectArchivedError, visible
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    ProjectRole,
    ResultSource,
    ResultStatus,
    annotations,
    opinions,
    projects,
    result_sets,
    review_assignments,
    review_edits,
    review_task_slides,
    review_tasks,
    verdicts,
)


class State(StrEnum):
    UPLOADED = "uploaded"
    AI_RUNNING = "ai-running"
    IMPORTED = "imported"
    READY = "ready"
    ASSIGNED = "assigned"
    IN_REVIEW = "in-review"
    SUBMITTED = "submitted"
    DISAGREEMENT_QUEUE = "disagreement-queue"
    SIGNED_OFF = "signed-off"
    EXPORTED = "exported"


ORDER = list(State)


class Move(StrEnum):
    SUBMIT = "submit"
    REOPEN_REVIEW = "reopen-review"
    SIGN_OFF = "sign-off"
    REOPEN_TASK = "reopen-task"


class Actor(StrEnum):
    ASSIGNED_REVIEWER = "assigned-reviewer"
    OWNER = "owner"
    OTHER = "other"


class Refused(StrEnum):
    NOT_ASSIGNED = "not-assigned"
    OWNERS_ONLY = "project-owners-only"
    TASK_SIGNED_OFF = "task-signed-off"
    ALREADY_SUBMITTED = "already-submitted"
    FIRST_READ_NEEDED = "first-read-needed"
    NOT_SUBMITTED = "not-submitted"
    SLIDES_UNSUBMITTED = "slides-unsubmitted"
    DISAGREEMENTS_OPEN = "disagreements-open"
    ALREADY_SIGNED_OFF = "already-signed-off"
    NOT_SIGNED_OFF = "not-signed-off"


REFUSALS: Mapping[Refused, tuple[type[ProblemError], str]] = {
    Refused.NOT_ASSIGNED: (ForbiddenError, "Only the reviewer assigned to this slide does that"),
    Refused.OWNERS_ONLY: (ForbiddenError, "Only an owner of this project does that"),
    Refused.TASK_SIGNED_OFF: (ConflictError, "The task is signed off. An owner can reopen it"),
    Refused.ALREADY_SUBMITTED: (ConflictError, "This slide is already submitted"),
    Refused.FIRST_READ_NEEDED: (
        ConflictError,
        "Record your first read without the AI before you submit this slide",
    ),
    Refused.NOT_SUBMITTED: (ConflictError, "This slide is not submitted"),
    Refused.SLIDES_UNSUBMITTED: (ConflictError, "Some reviewers have not submitted every slide"),
    Refused.DISAGREEMENTS_OPEN: (ConflictError, "Some disagreements are not decided yet"),
    Refused.ALREADY_SIGNED_OFF: (ConflictError, "The task is already signed off"),
    Refused.NOT_SIGNED_OFF: (ConflictError, "The task is not signed off"),
}


@dataclass(frozen=True)
class ReviewerFacts:
    submitted: bool
    has_work: bool


@dataclass(frozen=True)
class SlideFacts:
    set_status: ResultStatus
    set_source: ResultSource
    reviewers: Mapping[uuid.UUID, ReviewerFacts]
    open_disagreements: int = 0
    signed_off: bool = False
    exported: bool = False


@dataclass(frozen=True)
class MoveFacts:
    actor: Actor
    signed_off: bool
    submitted: bool = False
    first_read_open: bool = False
    all_submitted: bool = False
    open_disagreements: int = 0


def before_review(facts: SlideFacts) -> State | None:
    if facts.set_status is ResultStatus.READY:
        return None
    if facts.set_source is ResultSource.RUN and facts.set_status is ResultStatus.IMPORTING:
        return State.AI_RUNNING
    return State.UPLOADED


def reviewer_state(facts: ReviewerFacts) -> State:
    if facts.submitted:
        return State.SUBMITTED
    return State.IN_REVIEW if facts.has_work else State.ASSIGNED


def task_state(facts: SlideFacts) -> State:
    if facts.exported:
        return State.EXPORTED
    if facts.signed_off:
        return State.SIGNED_OFF
    if facts.open_disagreements:
        return State.DISAGREEMENT_QUEUE
    return State.SUBMITTED


def slide_state(facts: SlideFacts) -> State:
    early = before_review(facts)
    if early is not None:
        return early
    if not facts.reviewers:
        return State.READY
    states = [reviewer_state(reviewer) for reviewer in facts.reviewers.values()]
    if all(state is State.SUBMITTED for state in states):
        return task_state(facts)
    if facts.signed_off:
        return State.SIGNED_OFF
    return min(states, key=ORDER.index)


def check_move(move: Move, facts: MoveFacts) -> Refused | None:
    match move:
        case Move.SUBMIT | Move.REOPEN_REVIEW:
            if facts.actor is not Actor.ASSIGNED_REVIEWER:
                return Refused.NOT_ASSIGNED
            if facts.signed_off:
                return Refused.TASK_SIGNED_OFF
            if move is Move.SUBMIT and facts.submitted:
                return Refused.ALREADY_SUBMITTED
            if move is Move.SUBMIT and facts.first_read_open:
                return Refused.FIRST_READ_NEEDED
            if move is Move.REOPEN_REVIEW and not facts.submitted:
                return Refused.NOT_SUBMITTED
            return None
        case Move.SIGN_OFF:
            if facts.actor is not Actor.OWNER:
                return Refused.OWNERS_ONLY
            if facts.signed_off:
                return Refused.ALREADY_SIGNED_OFF
            if not facts.all_submitted:
                return Refused.SLIDES_UNSUBMITTED
            if facts.open_disagreements:
                return Refused.DISAGREEMENTS_OPEN
            return None
        case Move.REOPEN_TASK:
            if facts.actor is not Actor.OWNER:
                return Refused.OWNERS_ONLY
            return None if facts.signed_off else Refused.NOT_SIGNED_OFF


def problem_for(refused: Refused) -> ProblemError:
    kind, title = REFUSALS[refused]
    problem = kind(title)
    problem.code = refused.value
    problem.title = title
    return problem


class ReviewerState(BaseModel):
    user_id: uuid.UUID
    state: State
    submitted_at: datetime | None


class SlideState(BaseModel):
    slide_id: uuid.UUID
    state: State
    reviewers: list[ReviewerState]


class TaskStates(BaseModel):
    task_id: uuid.UUID
    signed_off_at: datetime | None
    slides: list[SlideState]


router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def task_of(connection: AsyncConnection, task_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(review_tasks, projects.c.archived_at.label("project_archived_at"))
            .join(projects, projects.c.id == review_tasks.c.project_id)
            .where(review_tasks.c.id == task_id, review_tasks.c.archived_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Review task not found")
    return row


async def assignment_rows(connection: AsyncConnection, task_id: uuid.UUID) -> list[Any]:
    worked = (
        select(review_edits.c.slide_id, review_edits.c.user_id)
        .where(review_edits.c.task_id == task_id)
        .union(
            select(annotations.c.slide_id, annotations.c.created_by_user_id).where(
                annotations.c.task_id == task_id
            ),
            select(verdicts.c.slide_id, verdicts.c.user_id).where(verdicts.c.task_id == task_id),
            select(opinions.c.slide_id, opinions.c.user_id).where(opinions.c.task_id == task_id),
        )
        .subquery()
    )
    has_work = (
        select(worked.c.slide_id)
        .where(
            worked.c.slide_id == review_assignments.c.slide_id,
            worked.c.user_id == review_assignments.c.user_id,
        )
        .exists()
    )
    rows = await connection.execute(
        select(
            review_assignments.c.slide_id,
            review_assignments.c.user_id,
            review_assignments.c.submitted_at,
            has_work.label("has_work"),
        )
        .where(review_assignments.c.task_id == task_id)
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    )
    return list(rows.all())


async def states_of(connection: AsyncConnection, task: Any) -> TaskStates:
    slide_rows = (
        await connection.execute(
            select(review_task_slides.c.slide_id, result_sets.c.status, result_sets.c.source)
            .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
            .where(review_task_slides.c.task_id == task.id)
            .order_by(review_task_slides.c.position)
        )
    ).all()
    open_disagreements = open_by_slide(await queue_of(connection, task.id))
    by_slide: dict[uuid.UUID, list[Any]] = {}
    for row in await assignment_rows(connection, task.id):
        by_slide.setdefault(row.slide_id, []).append(row)
    slides: list[SlideState] = []
    for slide in slide_rows:
        assigned = by_slide.get(slide.slide_id, [])
        facts = SlideFacts(
            set_status=ResultStatus(slide.status),
            set_source=ResultSource(slide.source),
            reviewers={
                row.user_id: ReviewerFacts(row.submitted_at is not None, bool(row.has_work))
                for row in assigned
            },
            open_disagreements=open_disagreements.get(slide.slide_id, 0),
            signed_off=task.signed_off_at is not None,
        )
        slides.append(
            SlideState(
                slide_id=slide.slide_id,
                state=slide_state(facts),
                reviewers=[
                    ReviewerState(
                        user_id=row.user_id,
                        state=reviewer_state(facts.reviewers[row.user_id]),
                        submitted_at=row.submitted_at,
                    )
                    for row in assigned
                ],
            )
        )
    return TaskStates(task_id=task.id, signed_off_at=task.signed_off_at, slides=slides)


async def actor_for(
    connection: AsyncConnection, principal: Principal, task: Any, slide_id: uuid.UUID | None
) -> Actor:
    if slide_id is not None:
        mine = select(review_assignments).where(
            review_assignments.c.task_id == task.id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == user_of(principal),
        )
        if await connection.scalar(select(mine.exists())):
            return Actor.ASSIGNED_REVIEWER
        return Actor.OTHER
    role = await role_in(connection, principal, task.project_id)
    return Actor.OWNER if role is ProjectRole.OWNER else Actor.OTHER


async def apply(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    move: Move,
    facts: MoveFacts,
    action: AuditAction,
    details: dict[str, Any],
) -> None:
    refused = check_move(move, facts)
    if refused is not None:
        raise problem_for(refused)
    if task.project_archived_at is not None:
        raise ProjectArchivedError
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        task.id,
        tenant_id=task.tenant_id,
        details=details,
    )


async def review_move(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    move: Move,
) -> TaskStates:
    task = await task_of(connection, task_id)
    await readable_task(connection, principal, task_id)
    submitted_at = await connection.scalar(
        select(review_assignments.c.submitted_at).where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == user_of(principal),
        )
    )
    facts = MoveFacts(
        actor=await actor_for(connection, principal, task, slide_id),
        signed_off=task.signed_off_at is not None,
        submitted=submitted_at is not None,
        first_read_open=await first_read_open(connection, principal, task_id, slide_id),
    )
    action = (
        AuditAction.TASK_REVIEW_SUBMITTED
        if move is Move.SUBMIT
        else AuditAction.TASK_REVIEW_REOPENED
    )
    await apply(connection, principal, task, move, facts, action, {"slide_id": str(slide_id)})
    await connection.execute(
        update(review_assignments)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == user_of(principal),
        )
        .values(submitted_at=func.now() if move is Move.SUBMIT else None)
    )
    return await states_of(connection, await task_of(connection, task_id))


@router.get(
    "/states", operation_id="getReviewTaskStates", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_review_task_states(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> TaskStates:
    task, whole = await readable_task(connection, principal, task_id)
    states = await states_of(connection, await task_of(connection, task.id))
    if whole:
        return states
    me = user_of(principal)
    mine = [slide for slide in states.slides if any(r.user_id == me for r in slide.reviewers)]
    return TaskStates(task_id=states.task_id, signed_off_at=states.signed_off_at, slides=mine)


@router.post(
    "/slides/{slide_id}/submit",
    operation_id="submitSlideReview",
    **require(Permission.REVIEW, write=True),
)
async def submit_slide_review(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TaskStates:
    return await review_move(connection, principal, task_id, slide_id, Move.SUBMIT)


@router.post(
    "/slides/{slide_id}/reopen",
    operation_id="reopenSlideReview",
    **require(Permission.REVIEW, write=True),
)
async def reopen_slide_review(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TaskStates:
    return await review_move(connection, principal, task_id, slide_id, Move.REOPEN_REVIEW)


async def task_move(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, move: Move
) -> TaskStates:
    task = await task_of(connection, task_id)
    await visible(connection, principal, task.project_id)
    states = await states_of(connection, task)
    unsubmitted = any(r.submitted_at is None for slide in states.slides for r in slide.reviewers)
    facts = MoveFacts(
        actor=await actor_for(connection, principal, task, None),
        signed_off=task.signed_off_at is not None,
        all_submitted=not unsubmitted,
        open_disagreements=open_count(await queue_of(connection, task_id)),
    )
    action = AuditAction.TASK_SIGNED_OFF if move is Move.SIGN_OFF else AuditAction.TASK_REOPENED
    await apply(connection, principal, task, move, facts, action, {})
    signing = move is Move.SIGN_OFF
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.id == task_id)
        .values(
            signed_off_at=func.now() if signing else None,
            signed_off_by_user_id=user_of(principal) if signing else None,
        )
    )
    return await states_of(connection, await task_of(connection, task_id))


@router.post(
    "/sign-off", operation_id="signOffReviewTask", **require(Permission.CREATE_CASES, write=True)
)
async def sign_off_review_task(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> TaskStates:
    return await task_move(connection, principal, task_id, Move.SIGN_OFF)


@router.post(
    "/reopen", operation_id="reopenReviewTask", **require(Permission.CREATE_CASES, write=True)
)
async def reopen_review_task(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> TaskStates:
    return await task_move(connection, principal, task_id, Move.REOPEN_TASK)
