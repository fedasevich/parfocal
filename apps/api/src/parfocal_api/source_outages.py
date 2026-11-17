import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.event_delivery import admins_of
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import notify
from parfocal_api.remote_reads import OFFLINE_AFTER_FAILURES
from parfocal_api.tables import NotificationKind, SlideStorage, import_sources, slides, tenants
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.jobs import PLATFORM

DOWN_AFTER = timedelta(minutes=15)
TITLE = "Connected source down"
ACTION = "Open storage"

logger = logging.getLogger("parfocal.api.remote")


def detail_of(name: str) -> str:
    return (
        f"{name} has not answered for 15 minutes. Slides read in place from it open only"
        " from the cache until it answers again."
    )


async def notice_outages(
    connection: AsyncConnection, now: datetime, only: ColumnElement[bool] | None = None
) -> int:
    since = func.min(slides.c.remote_failing_since)
    failing = (
        select(slides.c.source_id, since.label("since"))
        .where(
            slides.c.deleted_at.is_(None),
            slides.c.storage == SlideStorage.REMOTE,
            slides.c.source_id.is_not(None),
            slides.c.remote_failures >= OFFLINE_AFTER_FAILURES,
            slides.c.remote_failing_since.is_not(None),
        )
        .group_by(slides.c.source_id)
        .having(since <= now - DOWN_AFTER)
    )
    if only is not None:
        failing = failing.where(only)
    noticed = 0
    for outage in (await connection.execute(failing)).all():
        claimed = (
            await connection.execute(
                update(import_sources)
                .where(
                    import_sources.c.id == outage.source_id,
                    or_(
                        import_sources.c.down_notified_at.is_(None),
                        import_sources.c.down_notified_at < outage.since,
                    ),
                )
                .values(down_notified_at=now)
                .returning(import_sources.c.id, import_sources.c.tenant_id, import_sources.c.name)
            )
        ).one_or_none()
        if claimed is None:
            continue
        await notify(
            connection,
            claimed.tenant_id,
            await admins_of(connection, claimed.tenant_id),
            NotificationKind.INTEGRATION_DOWN,
            TargetKind.SOURCE,
            claimed.id,
            {
                "source_id": str(claimed.id),
                "title": TITLE,
                "detail": detail_of(claimed.name),
                "action": ACTION,
            },
        )
        noticed += 1
    return noticed


async def notice_if_down(connection: AsyncConnection, slide_id: uuid.UUID, now: datetime) -> int:
    source_id = await connection.scalar(select(slides.c.source_id).where(slides.c.id == slide_id))
    if source_id is None:
        return 0
    return await notice_outages(connection, now, slides.c.source_id == source_id)


async def notice_every_workspace(engine: AsyncEngine, now: datetime) -> int:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    noticed = 0
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            noticed += await notice_outages(connection, now)
    if noticed:
        logger.info("connected sources down", extra={"count": noticed})
    return noticed
