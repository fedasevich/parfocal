import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_layer import KINDS, TaskSignedOffError, ai_object
from parfocal_api.tables import (
    AnnotationKind,
    Decision,
    ProjectRole,
    VerdictReason,
    VerdictValue,
    disagreement_decisions,
    review_assignments,
    verdicts,
)
from parfocal_common.disagreements import Why, why_queued
from parfocal_common.object_ids import Letter, ObjectId


class ReviewerVerdict(BaseModel):
    user_id: uuid.UUID
    value: VerdictValue
    reason: VerdictReason | None


class QueuedObject(BaseModel):
    slide_id: uuid.UUID
    object: str
    kind: AnnotationKind
    number: int
    why: Why
    verdicts: list[ReviewerVerdict]
    decision: Decision | None = None
    note: str | None = None


class DecisionDraft(BaseModel):
    decision: Decision
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class NotQueuedError(NotFoundError):
    code = "not-queued"
    title = "This object is not in the disagreement queue"


class DecidersOnlyError(ForbiddenError):
    code = "project-owners-only"
    title = "Only an owner of this project decides disagreements"


class QueueHiddenError(ForbiddenError):
    code = "disagreements-hidden"
    title = "Reviewers do not see the disagreement queue"


router = APIRouter(prefix="/api/review-tasks/{task_id}/disagreements", tags=["review-tasks"])


async def complete_slides(
    connection: AsyncConnection, task_id: uuid.UUID
) -> dict[uuid.UUID, set[uuid.UUID]]:
    reviewers: dict[uuid.UUID, set[uuid.UUID]] = {}
    pending: set[uuid.UUID] = set()
    for slide_id, user_id, submitted_at in await connection.execute(
        select(
            review_assignments.c.slide_id,
            review_assignments.c.user_id,
            review_assignments.c.submitted_at,
        ).where(review_assignments.c.task_id == task_id)
    ):
        reviewers.setdefault(slide_id, set()).add(user_id)
        if submitted_at is None:
            pending.add(slide_id)
    return {slide: people for slide, people in reviewers.items() if slide not in pending}


async def queue_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[QueuedObject]:
    complete = await complete_slides(connection, task_id)
    if not complete:
        return []
    grouped: dict[tuple[uuid.UUID, str, int], list[Any]] = {}
    for row in await connection.execute(
        select(verdicts)
        .where(verdicts.c.task_id == task_id, verdicts.c.slide_id.in_(list(complete)))
        .order_by(verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number, verdicts.c.user_id)
    ):
        if row.user_id in complete[row.slide_id]:
            grouped.setdefault((row.slide_id, row.kind, row.number), []).append(row)
    decided = {
        (row.slide_id, row.kind, row.number): row
        for row in await connection.execute(
            select(disagreement_decisions).where(disagreement_decisions.c.task_id == task_id)
        )
    }
    queued: list[QueuedObject] = []
    for (slide_id, kind, number), rows in grouped.items():
        why = why_queued({row.user_id: row.value for row in rows})
        if why is None:
            continue
        object_kind = AnnotationKind(kind)
        letter = Letter.REGION if object_kind is AnnotationKind.REGION else Letter.CELL
        queued.append(
            QueuedObject(
                slide_id=slide_id,
                object=ObjectId(letter, number).text(ascii=True),
                kind=object_kind,
                number=number,
                why=why,
                verdicts=[
                    ReviewerVerdict(
                        user_id=row.user_id,
                        value=VerdictValue(row.value),
                        reason=VerdictReason(row.reason) if row.reason else None,
                    )
                    for row in rows
                ],
                decision=Decision(choice.decision)
                if (choice := decided.get((slide_id, kind, number)))
                else None,
                note=choice.note if choice else None,
            )
        )
    return queued


def open_by_slide(queue: list[QueuedObject]) -> dict[uuid.UUID, int]:
    counts: dict[uuid.UUID, int] = {}
    for item in queue:
        if item.decision is None:
            counts[item.slide_id] = counts.get(item.slide_id, 0) + 1
    return counts


@router.get("", operation_id="listDisagreements", **require(Permission.SEE_SLIDES, emergency=True))
async def list_disagreements(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[QueuedObject]:
    _, whole = await readable_task(connection, principal, task_id)
    if not whole:
        raise QueueHiddenError
    return await queue_of(connection, task_id)


def open_count(queue: list[QueuedObject]) -> int:
    return sum(item.decision is None for item in queue)


async def decidable(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
) -> tuple[Any, ObjectId]:
    task, _ = await readable_task(connection, principal, task_id)
    if await role_in(connection, principal, task.project_id) is not ProjectRole.OWNER:
        raise DecidersOnlyError
    if task.signed_off_at is not None:
        raise TaskSignedOffError
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    queue = await queue_of(connection, task_id)
    if not any(
        item.slide_id == slide_id and item.kind is kind and item.number == found.number
        for item in queue
    ):
        raise NotQueuedError
    return task, found


def same_object(
    task_id: uuid.UUID, slide_id: uuid.UUID, kind: AnnotationKind, number: int
) -> list[Any]:
    return [
        disagreement_decisions.c.task_id == task_id,
        disagreement_decisions.c.slide_id == slide_id,
        disagreement_decisions.c.kind == kind,
        disagreement_decisions.c.number == number,
    ]


@router.put(
    "/{slide_id}/{object_id}",
    operation_id="decideDisagreement",
    **require(Permission.CREATE_CASES, write=True),
)
async def decide_disagreement(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: DecisionDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> QueuedObject:
    task, found = await decidable(connection, principal, task_id, slide_id, object_id)
    kind = KINDS[found.letter]
    values = {
        "decision": draft.decision,
        "note": draft.note or None,
        "decided_by_user_id": principal.user_id if isinstance(principal, MemberPrincipal) else None,
    }
    await connection.execute(
        upsert(disagreement_decisions)
        .values(
            tenant_id=task.tenant_id,
            project_id=task.project_id,
            task_id=task_id,
            slide_id=slide_id,
            kind=kind,
            number=found.number,
            **values,
        )
        .on_conflict_do_update(
            index_elements=[
                disagreement_decisions.c.task_id,
                disagreement_decisions.c.slide_id,
                disagreement_decisions.c.kind,
                disagreement_decisions.c.number,
            ],
            set_=values,
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_DECISION_SET,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=task.tenant_id,
        details={
            "slide_id": str(slide_id),
            "object": found.text(ascii=True),
            "decision": draft.decision.value,
        },
    )
    return next(
        item
        for item in await queue_of(connection, task_id)
        if item.slide_id == slide_id and item.kind is kind and item.number == found.number
    )


@router.delete(
    "/{slide_id}/{object_id}",
    operation_id="clearDisagreementDecision",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def clear_disagreement_decision(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    task, found = await decidable(connection, principal, task_id, slide_id, object_id)
    cleared = await connection.execute(
        delete(disagreement_decisions).where(
            *same_object(task_id, slide_id, KINDS[found.letter], found.number)
        )
    )
    if cleared.rowcount:
        await record(
            connection,
            actor_of(principal),
            AuditAction.REVIEW_DECISION_CLEARED,
            AuditTarget.REVIEW_TASK,
            task_id,
            tenant_id=task.tenant_id,
            details={"slide_id": str(slide_id), "object": found.text(ascii=True)},
        )
    return Response(status_code=204)
