import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ForbiddenError
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    AnnotationKind,
    VerdictReason,
    VerdictValue,
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
            )
        )
    return queued


def open_by_slide(queue: list[QueuedObject]) -> dict[uuid.UUID, int]:
    counts: dict[uuid.UUID, int] = {}
    for item in queue:
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
