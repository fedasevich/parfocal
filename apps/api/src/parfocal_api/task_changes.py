import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, insert, or_, select, union, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, pseudonym_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import deliver_after_commit
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.projects import ProjectArchivedError, owned
from parfocal_api.realtime import RealtimeClient
from parfocal_api.review_tasks import (
    ReviewTaskDetail,
    audit,
    check_reviewers,
    detail_of,
    task_row,
)
from parfocal_api.reviewed_layer import TaskSignedOffError
from parfocal_api.tables import (
    NotificationKind,
    ReassignWhat,
    annotations,
    notifications,
    opinions,
    review_assignments,
    review_decisions,
    review_edits,
    review_skips,
    review_task_slides,
    task_nudges,
    task_reassignments,
    users,
)
from parfocal_api.task_notices import iso, told
from parfocal_api.worklist_events import announce_worklist, task_people

type NudgeMessage = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
type ReassignmentNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class NudgeCreate(BaseModel):
    user_id: uuid.UUID
    message: NudgeMessage


class Nudge(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    sent_at: datetime


class ReassignmentCreate(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    what: ReassignWhat = ReassignWhat.NOT_STARTED
    note: ReassignmentNote | None = None


class Reassignment(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    what: ReassignWhat
    slides_moved: int
    moved_slide_ids: list[uuid.UUID]
    kept_slide_ids: list[uuid.UUID]


class TaskReviewerCreate(BaseModel):
    user_id: uuid.UUID
    slide_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=500)] | None = None


class NotOnTaskError(NotFoundError):
    code = "not-on-task"
    title = "This person reviews no slide of this task"


class SameReviewerError(BadRequestError):
    code = "same-reviewer"
    title = "Slides cannot be reassigned to the person who has them"


class NothingToMoveError(ConflictError):
    code = "nothing-to-move"
    title = "This reviewer has no slides that match"


class AlreadyReviewsSlideError(ConflictError):
    code = "already-reviews-slide"
    title = "This person already reviews one of these slides"


class ReassignmentStartedError(ConflictError):
    code = "reassignment-started"
    title = "The new reviewer has started these slides, so the reassign cannot be undone"


class NudgeNotFoundError(NotFoundError):
    code = "nudge-not-found"
    title = "Nudge not found"


class ReassignmentNotFoundError(NotFoundError):
    code = "reassignment-not-found"
    title = "Reassignment not found"


class UnknownTaskSlideError(BadRequestError):
    code = "unknown-task-slide"
    title = "Every slide must belong to this task"


router = APIRouter(prefix="/api/review-tasks", tags=["review-tasks"])


async def changeable_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID
) -> Any:
    row = await task_row(connection, task_id)
    project = await owned(connection, principal, row.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    if row.signed_off_at is not None:
        raise TaskSignedOffError
    return row


async def live_rows(
    connection: AsyncConnection, task_id: uuid.UUID, user_id: uuid.UUID
) -> list[Any]:
    return list(
        (
            await connection.execute(
                select(review_assignments.c.slide_id, review_assignments.c.submitted_at)
                .join(
                    review_task_slides,
                    (review_task_slides.c.task_id == review_assignments.c.task_id)
                    & (review_task_slides.c.slide_id == review_assignments.c.slide_id),
                )
                .where(
                    review_assignments.c.task_id == task_id,
                    review_assignments.c.user_id == user_id,
                    review_assignments.c.released_at.is_(None),
                )
                .order_by(review_task_slides.c.position)
            )
        ).all()
    )


async def started_slides(
    connection: AsyncConnection, task_id: uuid.UUID, user_id: uuid.UUID
) -> set[uuid.UUID]:
    worked = union(
        select(review_assignments.c.slide_id).where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.user_id == user_id,
            or_(
                review_assignments.c.submitted_at.is_not(None),
                review_assignments.c.first_read_at.is_not(None),
            ),
        ),
        select(review_decisions.c.slide_id).where(
            review_decisions.c.task_id == task_id, review_decisions.c.user_id == user_id
        ),
        select(review_edits.c.slide_id).where(
            review_edits.c.task_id == task_id, review_edits.c.user_id == user_id
        ),
        select(review_skips.c.slide_id).where(
            review_skips.c.task_id == task_id, review_skips.c.user_id == user_id
        ),
        select(opinions.c.slide_id).where(
            opinions.c.task_id == task_id, opinions.c.user_id == user_id
        ),
        select(annotations.c.slide_id).where(
            annotations.c.task_id == task_id, annotations.c.created_by_user_id == user_id
        ),
    )
    return set(await connection.scalars(select(worked.subquery().c.slide_id)))


async def place(
    connection: AsyncConnection,
    row: Any,
    user_id: uuid.UUID,
    slide_ids: Sequence[uuid.UUID],
) -> None:
    held: dict[uuid.UUID, Any] = {}
    for slide_id, released_at in await connection.execute(
        select(review_assignments.c.slide_id, review_assignments.c.released_at).where(
            review_assignments.c.task_id == row.id,
            review_assignments.c.user_id == user_id,
            review_assignments.c.slide_id.in_(slide_ids),
        )
    ):
        held[slide_id] = released_at
    if any(released_at is None for released_at in held.values()):
        raise AlreadyReviewsSlideError
    if held:
        await connection.execute(
            update(review_assignments)
            .where(
                review_assignments.c.task_id == row.id,
                review_assignments.c.user_id == user_id,
                review_assignments.c.slide_id.in_(list(held)),
            )
            .values(released_at=None, assigned_at=func.now())
        )
    fresh = [slide_id for slide_id in slide_ids if slide_id not in held]
    if fresh:
        await connection.execute(
            insert(review_assignments),
            [
                {
                    "tenant_id": row.tenant_id,
                    "task_id": row.id,
                    "slide_id": slide,
                    "user_id": user_id,
                }
                for slide in fresh
            ],
        )


async def person_of(connection: AsyncConnection, user_id: uuid.UUID) -> str:
    subject = await connection.scalar(select(users.c.subject).where(users.c.id == user_id))
    return str(await pseudonym_of(connection, subject)) if subject else ""


def sender_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def remove(
    connection: AsyncConnection, row: Any, user_id: uuid.UUID, slides: list[Any]
) -> None:
    if slides:
        await connection.execute(
            delete(review_assignments).where(
                review_assignments.c.task_id == row.id,
                review_assignments.c.user_id == user_id,
                review_assignments.c.slide_id.in_(slides),
            )
        )


@router.post(
    "/{task_id}/nudges",
    operation_id="nudgeReviewer",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def nudge_reviewer(
    task_id: uuid.UUID,
    request: NudgeCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> Nudge:
    row = await changeable_task(connection, principal, task_id)
    rows = await live_rows(connection, task_id, request.user_id)
    if not rows:
        raise NotOnTaskError
    left = sum(1 for slide in rows if slide.submitted_at is None)
    nudge = (
        await connection.execute(
            insert(task_nudges)
            .values(
                tenant_id=row.tenant_id,
                task_id=task_id,
                user_id=request.user_id,
                sent_by_user_id=sender_of(principal),
            )
            .returning(task_nudges.c.id, task_nudges.c.sent_at)
        )
    ).one()
    await told(
        connection,
        row,
        [request.user_id],
        NotificationKind.TASK_NUDGED,
        {
            "nudge_id": str(nudge.id),
            "message": request.message,
            "slides_left": left,
            "due_on": iso(row.due_on),
        },
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_NUDGED,
        row.tenant_id,
        task_id,
        {
            "reviewer": await person_of(connection, request.user_id),
            "slides_left": left,
            "message_length": len(request.message),
        },
    )
    background.add_task(deliver_after_commit, http.app, row.tenant_id)
    return Nudge(id=nudge.id, task_id=task_id, user_id=request.user_id, sent_at=nudge.sent_at)


@router.delete(
    "/{task_id}/nudges/{nudge_id}",
    operation_id="cancelNudge",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def cancel_nudge(
    task_id: uuid.UUID,
    nudge_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> None:
    row = await changeable_task(connection, principal, task_id)
    gone = await connection.scalar(
        delete(task_nudges)
        .where(task_nudges.c.id == nudge_id, task_nudges.c.task_id == task_id)
        .returning(task_nudges.c.user_id)
    )
    if gone is None:
        raise NudgeNotFoundError
    await connection.execute(
        delete(notifications).where(
            notifications.c.task_id == task_id,
            notifications.c.user_id == gone,
            notifications.c.kind == NotificationKind.TASK_NUDGED,
            notifications.c.payload["nudge_id"].astext == str(nudge_id),
        )
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_NUDGE_CANCELLED,
        row.tenant_id,
        task_id,
        {"reviewer": await person_of(connection, gone)},
    )


@router.post(
    "/{task_id}/reassignments",
    operation_id="reassignSlides",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def reassign_slides(
    task_id: uuid.UUID,
    request: ReassignmentCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
    live: RealtimeClient,
) -> Reassignment:
    row = await changeable_task(connection, principal, task_id)
    if request.from_user_id == request.to_user_id:
        raise SameReviewerError
    rows = await live_rows(connection, task_id, request.from_user_id)
    if not rows:
        raise NotOnTaskError
    await check_reviewers(connection, row.project_id, [request.to_user_id])
    started = await started_slides(connection, task_id, request.from_user_id)
    moving = [
        slide.slide_id
        for slide in rows
        if request.what is ReassignWhat.ALL or slide.slide_id not in started
    ]
    if not moving:
        raise NothingToMoveError
    kept = [slide for slide in moving if slide in started]
    await place(connection, row, request.to_user_id, moving)
    if kept:
        await connection.execute(
            update(review_assignments)
            .where(
                review_assignments.c.task_id == task_id,
                review_assignments.c.user_id == request.from_user_id,
                review_assignments.c.slide_id.in_(kept),
            )
            .values(released_at=func.now())
        )
    await remove(connection, row, request.from_user_id, [s for s in moving if s not in started])
    reassignment_id = await connection.scalar(
        insert(task_reassignments)
        .values(
            tenant_id=row.tenant_id,
            task_id=task_id,
            from_user_id=request.from_user_id,
            to_user_id=request.to_user_id,
            what=request.what,
            slide_ids=moving,
            kept_slide_ids=kept,
        )
        .returning(task_reassignments.c.id)
    )
    assert isinstance(reassignment_id, uuid.UUID)
    shared = {
        "reassignment_id": str(reassignment_id),
        "slides": len(moving),
        "note": request.note or None,
    }
    for person, direction in ((request.from_user_id, "away"), (request.to_user_id, "to-you")):
        await told(
            connection,
            row,
            [person],
            NotificationKind.TASK_REASSIGNED,
            shared | {"direction": direction},
        )
    await audit(
        connection,
        principal,
        AuditAction.TASK_REASSIGNED,
        row.tenant_id,
        task_id,
        {
            "from": await person_of(connection, request.from_user_id),
            "to": await person_of(connection, request.to_user_id),
            "what": request.what.value,
            "moved": len(moving),
            "kept": len(kept),
            "note_given": bool(request.note),
        },
    )
    background.add_task(deliver_after_commit, http.app, row.tenant_id)
    announce_worklist(
        background,
        live,
        row.tenant_id,
        {request.from_user_id} | await task_people(connection, task_id),
        task=task_id,
    )
    return Reassignment(
        id=reassignment_id,
        task_id=task_id,
        from_user_id=request.from_user_id,
        to_user_id=request.to_user_id,
        what=request.what,
        slides_moved=len(moving),
        moved_slide_ids=moving,
        kept_slide_ids=kept,
    )


@router.delete(
    "/{task_id}/reassignments/{reassignment_id}",
    operation_id="undoReassignment",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def undo_reassignment(
    task_id: uuid.UUID,
    reassignment_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    live: RealtimeClient,
    background: BackgroundTasks,
) -> None:
    row = await changeable_task(connection, principal, task_id)
    move = (
        await connection.execute(
            select(task_reassignments)
            .where(
                task_reassignments.c.id == reassignment_id,
                task_reassignments.c.task_id == task_id,
                task_reassignments.c.undone_at.is_(None),
            )
            .with_for_update()
        )
    ).one_or_none()
    if move is None:
        raise ReassignmentNotFoundError
    moved = list(move.slide_ids)
    if set(moved) & await started_slides(connection, task_id, move.to_user_id):
        raise ReassignmentStartedError
    await remove(connection, row, move.to_user_id, moved)
    await place(connection, row, move.from_user_id, moved)
    await connection.execute(
        update(task_reassignments)
        .where(task_reassignments.c.id == reassignment_id)
        .values(undone_at=func.now())
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_REASSIGNMENT_UNDONE,
        row.tenant_id,
        task_id,
        {"moved_back": len(moved)},
    )
    announce_worklist(
        background,
        live,
        row.tenant_id,
        {move.to_user_id} | await task_people(connection, task_id),
        task=task_id,
    )


@router.post(
    "/{task_id}/reviewers",
    operation_id="addTaskReviewer",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def add_task_reviewer(
    task_id: uuid.UUID,
    request: TaskReviewerCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
    live: RealtimeClient,
) -> ReviewTaskDetail:
    row = await changeable_task(connection, principal, task_id)
    await check_reviewers(connection, row.project_id, [request.user_id])
    task_slides = list(
        await connection.scalars(
            select(review_task_slides.c.slide_id)
            .where(review_task_slides.c.task_id == task_id)
            .order_by(review_task_slides.c.position)
        )
    )
    wanted = list(dict.fromkeys(request.slide_ids or task_slides))
    if not set(wanted) <= set(task_slides):
        raise UnknownTaskSlideError
    await place(connection, row, request.user_id, wanted)
    await told(
        connection,
        row,
        [request.user_id],
        NotificationKind.TASK_ASSIGNED,
        {"slides": len(wanted), "due_on": iso(row.due_on)},
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_REVIEWER_ADDED,
        row.tenant_id,
        task_id,
        {"reviewer": await person_of(connection, request.user_id), "slides": len(wanted)},
    )
    background.add_task(deliver_after_commit, http.app, row.tenant_id)
    announce_worklist(
        background, live, row.tenant_id, await task_people(connection, task_id), task=task_id
    )
    return await detail_of(connection, principal, await task_row(connection, task_id), True)
