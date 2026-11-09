import uuid
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import ColumnElement, and_, exists, not_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.realtime import Realtime, RoomEvent
from parfocal_api.room_access import RoomKind, room_name
from parfocal_api.tables import AnnotationOrigin, annotations, review_assignments

VISIBILITY_EVENT = "layer.visibility-changed"


def viewer_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


def author_unchecked() -> ColumnElement[bool]:
    return exists(
        select(review_assignments.c.user_id).where(
            review_assignments.c.task_id == annotations.c.task_id,
            review_assignments.c.slide_id == annotations.c.slide_id,
            review_assignments.c.user_id == annotations.c.created_by_user_id,
            review_assignments.c.submitted_at.is_(None),
            review_assignments.c.released_at.is_(None),
        )
    )


def hidden_from(viewer: uuid.UUID | None) -> ColumnElement[bool]:
    return and_(
        annotations.c.origin == AnnotationOrigin.HUMAN,
        annotations.c.created_by_user_id.is_distinct_from(viewer),
        author_unchecked(),
    )


def seen_by(blind_first: bool, principal: Principal) -> list[ColumnElement[bool]]:
    return [not_(hidden_from(viewer_of(principal)))] if blind_first else []


async def held_by(
    connection: AsyncConnection, row: Any, annotation_id: uuid.UUID
) -> uuid.UUID | None:
    if not row.blind_first:
        return None
    found = (
        await connection.execute(
            select(annotations.c.created_by_user_id).where(
                annotations.c.id == annotation_id, hidden_from(None)
            )
        )
    ).one_or_none()
    return None if found is None else found.created_by_user_id


def announce_visibility(
    background: BackgroundTasks, live: Realtime, row: Any, user_id: uuid.UUID | None
) -> None:
    if not row.blind_first or user_id is None:
        return
    event = RoomEvent(
        kind=VISIBILITY_EVENT, ids={"task": row.task_id, "slide": row.slide_id, "user": user_id}
    )
    background.add_task(live.publish, row.tenant_id, [room_name(RoomKind.TASK, row.task_id)], event)
