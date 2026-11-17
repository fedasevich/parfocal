import logging
import uuid
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from sqlalchemy import ColumnElement, exists, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import EventKind, EventStatus, event_outbox, event_targets

logger = logging.getLogger("parfocal.events")

Waker = Callable[[], Awaitable[None]]


async def no_wake() -> None:
    return None


class Wakeup:
    waker: Waker = staticmethod(no_wake)


def set_waker(waker: Waker) -> None:
    Wakeup.waker = staticmethod(waker)


async def wake() -> None:
    try:
        await Wakeup.waker()
    except Exception:
        logger.warning("event sweep could not be started", exc_info=True)


def listening(project_id: uuid.UUID, kind: EventKind) -> ColumnElement[bool]:
    return (event_targets.c.project_id == project_id) & event_targets.c.events.contains(
        [kind.value]
    )


async def subscribed(connection: AsyncConnection, project_id: uuid.UUID, kind: EventKind) -> bool:
    return bool(await connection.scalar(select(exists().where(listening(project_id, kind)))))


async def emit(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    kind: EventKind,
    data: Mapping[str, Any],
) -> int:
    targets = (
        await connection.execute(
            select(event_targets.c.id, event_targets.c.paused_at).where(listening(project_id, kind))
        )
    ).all()
    body = {key: str(value) for key, value in data.items()}
    if targets:
        await connection.execute(
            insert(event_outbox),
            [
                {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "target_id": target.id,
                    "kind": kind,
                    "body": body,
                    "status": EventStatus.FAILED if target.paused_at else EventStatus.PENDING,
                }
                for target in targets
            ],
        )
    live = sum(target.paused_at is None for target in targets)
    if live:
        await wake()
    return live
