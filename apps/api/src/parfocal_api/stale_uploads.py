import asyncio
import logging
import uuid
from datetime import timedelta

import httpx2
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.audit import AuditAction, AuditTarget, record
from parfocal_api.retention import SYSTEM
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import UploadStatus, tenants, uploads
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import load_settings

STALE_AFTER = timedelta(hours=24)

logger = logging.getLogger("parfocal.api.uploads")


async def abort_stale_uploads(
    engine: AsyncEngine, store: ObjectStore, idle: timedelta = STALE_AFTER
) -> list[uuid.UUID]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    expired: list[uuid.UUID] = []
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            rows = (
                await connection.execute(
                    select(uploads)
                    .where(
                        uploads.c.status == UploadStatus.OPEN,
                        uploads.c.last_activity_at < func.now() - idle,
                    )
                    .order_by(uploads.c.last_activity_at)
                    .with_for_update(skip_locked=True)
                )
            ).all()
            for row in rows:
                await store.abort_multipart_upload(row.object_key, row.storage_upload_id)
                await connection.execute(
                    update(uploads)
                    .where(uploads.c.id == row.id)
                    .values(status=UploadStatus.EXPIRED, closed_at=func.now())
                )
                await record(
                    connection,
                    SYSTEM,
                    AuditAction.UPLOAD_EXPIRED,
                    AuditTarget.UPLOAD,
                    row.id,
                    tenant_id=tenant_id,
                    details={"project_id": str(row.project_id), "size_bytes": row.size_bytes},
                )
                expired.append(row.id)
    if expired:
        logger.info("stale uploads aborted", extra={"count": len(expired)})
    return expired


async def run_once(settings: ApiSettings) -> int:
    engine = create_engine(str(settings.database_url))
    try:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(settings.storage(), http)
            return len(await abort_stale_uploads(engine, store))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_once(load_settings(ApiSettings)))
