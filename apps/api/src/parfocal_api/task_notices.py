import uuid
from collections.abc import Iterable
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import notify
from parfocal_api.tables import NotificationKind, review_assignments


def iso(day: date | None) -> str | None:
    return day.isoformat() if day is not None else None


async def told(
    connection: AsyncConnection,
    row: Any,
    people: Iterable[uuid.UUID],
    kind: NotificationKind,
    payload: dict[str, Any],
) -> None:
    await notify(connection, row.tenant_id, people, kind, TargetKind.TASK, row.id, payload)


async def tell_due_changed(connection: AsyncConnection, row: Any, due_on: date | None) -> None:
    people = await connection.scalars(
        select(review_assignments.c.user_id)
        .distinct()
        .where(
            review_assignments.c.task_id == row.id,
            review_assignments.c.released_at.is_(None),
            review_assignments.c.submitted_at.is_(None),
        )
    )
    await told(
        connection, row, people.all(), NotificationKind.TASK_DUE_CHANGED, {"due_on": iso(due_on)}
    )
