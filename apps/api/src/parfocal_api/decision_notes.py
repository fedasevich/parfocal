import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import sees_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.mentions import MAX_MENTIONS, BadMentionError, mentioned_in
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.project_access import principal_of, project_grant, reads_whole
from parfocal_api.reviewed_layer import review_slide, task_slide
from parfocal_api.tables import (
    AnnotationKind,
    NotificationKind,
    VerdictReason,
    VerdictValue,
    notifications,
    review_assignments,
    review_tasks,
    verdicts,
)
from parfocal_common.object_ids import Letter, ObjectId


class DecisionNote(BaseModel):
    object: str
    author_id: uuid.UUID
    value: VerdictValue
    answer: str
    reasons: list[VerdictReason]
    note: str
    mentions: list[uuid.UUID]
    updated_at: datetime


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/decision-notes", tags=["review-tasks"]
)


def object_text(kind: str, number: int) -> str:
    letter = Letter.REGION if AnnotationKind(kind) is AnnotationKind.REGION else Letter.CELL
    return ObjectId(letter, number).text(ascii=True)


def note_of(row: Any) -> DecisionNote:
    return DecisionNote(
        object=object_text(row.kind, row.number),
        author_id=row.user_id,
        value=VerdictValue(row.value),
        answer=row.answer,
        reasons=[VerdictReason(code) for code in row.reasons],
        note=row.note,
        mentions=mentioned_in(row.note),
        updated_at=row.updated_at,
    )


async def opener(connection: AsyncConnection, place: Any, person: uuid.UUID) -> Principal | None:
    reader = await principal_of(connection, place.tenant_id, person)
    if reader is None:
        return None
    try:
        await task_slide(connection, reader, place.task_id, place.slide_id)
    except NotFoundError, ForbiddenError:
        return None
    return reader


async def sees(
    connection: AsyncConnection, reader: Principal, place: Any, author: uuid.UUID
) -> bool:
    person = await principal_of(connection, place.tenant_id, author)
    if person is not None and reads_whole(
        await project_grant(connection, person, place.project_id, Permission.SEE_SLIDES)
    ):
        return True
    return await sees_reviewer(
        connection, reader, place.project_id, place.task_id, place.slide_id, author
    )


async def checked_note_mentions(
    connection: AsyncConnection, principal: Principal, place: Any, note: str | None
) -> list[uuid.UUID]:
    me = user_of(principal)
    named = [person for person in mentioned_in(note or "") if person != me]
    if len(named) > MAX_MENTIONS:
        raise BadMentionError(f"A note mentions at most {MAX_MENTIONS} people")
    for person in named:
        if await opener(connection, place, person) is None or not await sees(
            connection, principal, place, person
        ):
            raise BadMentionError
    return named


async def held(connection: AsyncConnection, place: Any, author: uuid.UUID) -> bool:
    blinded = await connection.scalar(
        select(review_tasks.c.blinded).where(review_tasks.c.id == place.task_id)
    )
    if not blinded:
        return False
    submitted_at = await connection.scalar(
        select(review_assignments.c.submitted_at).where(
            review_assignments.c.task_id == place.task_id,
            review_assignments.c.slide_id == place.slide_id,
            review_assignments.c.user_id == author,
        )
    )
    return submitted_at is None


async def already_told(
    connection: AsyncConnection, person: uuid.UUID, payload: dict[str, str]
) -> bool:
    found = select(notifications.c.id).where(
        notifications.c.user_id == person,
        notifications.c.kind == NotificationKind.MENTION,
        notifications.c.target_type == TargetKind.DECISION,
        notifications.c.target_id == uuid.UUID(payload["slide_id"]),
        notifications.c.payload.contains(payload),
    )
    return bool(await connection.scalar(select(found.exists())))


async def tell_mentioned(connection: AsyncConnection, place: Any, row: Any) -> int:
    author = row.user_id
    if await held(connection, place, author):
        return 0
    payload = {
        "task_id": str(place.task_id),
        "slide_id": str(place.slide_id),
        "object_id": object_text(row.kind, row.number),
        "actor_user_id": str(author),
    }
    due: list[uuid.UUID] = []
    for person in mentioned_in(row.note or ""):
        if person == author or await already_told(connection, person, payload):
            continue
        reader = await opener(connection, place, person)
        if reader is not None and await sees(connection, reader, place, author):
            due.append(person)
    if not due:
        return 0
    return await notify(
        connection,
        place.tenant_id,
        due,
        NotificationKind.MENTION,
        TargetKind.DECISION,
        place.slide_id,
        payload,
    )


async def tell_mentioned_on_slide(connection: AsyncConnection, place: Any) -> int:
    rows = await connection.execute(
        select(verdicts).where(
            verdicts.c.task_id == place.task_id,
            verdicts.c.slide_id == place.slide_id,
            verdicts.c.note.contains("@["),
        )
    )
    told = 0
    for row in rows.all():
        told += await tell_mentioned(connection, place, row)
    return told


@router.get("", operation_id="listDecisionNotes", **require(Permission.SEE_SLIDES, emergency=True))
async def list_decision_notes(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[DecisionNote]:
    place = await review_slide(connection, principal, task_id, slide_id)
    rows = await connection.execute(
        select(verdicts)
        .where(
            verdicts.c.task_id == task_id,
            verdicts.c.slide_id == slide_id,
            verdicts.c.note.is_not(None),
        )
        .order_by(verdicts.c.kind, verdicts.c.number, verdicts.c.updated_at)
    )
    seen: dict[uuid.UUID, bool] = {}
    found: list[DecisionNote] = []
    for row in rows.all():
        if row.user_id not in seen:
            seen[row.user_id] = await sees_reviewer(
                connection, principal, place.project_id, task_id, slide_id, row.user_id
            )
        if seen[row.user_id]:
            found.append(note_of(row))
    return found
