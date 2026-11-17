import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import EventKind, event_outbox, event_targets


async def emit(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    kind: EventKind,
    data: Mapping[str, Any],
) -> int:
    targets = (
        await connection.scalars(
            select(event_targets.c.id).where(
                event_targets.c.project_id == project_id,
                event_targets.c.paused_at.is_(None),
                event_targets.c.events.contains([kind.value]),
            )
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
                    "target_id": target,
                    "kind": kind,
                    "body": body,
                }
                for target in targets
            ],
        )
    return len(targets)
