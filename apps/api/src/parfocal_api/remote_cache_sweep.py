import asyncio
import logging
from datetime import UTC, datetime

import httpx2
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.remote_reads import sweep_remote_cache
from parfocal_api.settings import ApiSettings
from parfocal_api.source_outages import notice_every_workspace
from parfocal_api.tables import tenants
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import load_settings

logger = logging.getLogger("parfocal.api.remote")


async def sweep_every_workspace(engine: AsyncEngine, store: ObjectStore, now: datetime) -> int:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    removed = 0
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            removed += await sweep_remote_cache(store, connection, now)
    if removed:
        logger.info("remote tile caches swept", extra={"count": removed})
    return removed


async def run_once(settings: ApiSettings) -> int:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        now = datetime.now(UTC)
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(settings.storage(), http)
            removed = await sweep_every_workspace(engine, store, now)
        await notice_every_workspace(engine, now)
        return removed
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_once(load_settings(ApiSettings)))
