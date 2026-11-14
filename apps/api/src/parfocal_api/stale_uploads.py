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
from parfocal_api.tables import UploadStatus, jobs, tenants, uploads
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.jobs import PLATFORM, JobStatus
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_imports import UploadKind
from parfocal_common.settings import load_settings

STALE_AFTER = timedelta(hours=24)
CHOICES_WAIT = timedelta(days=7)

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


async def sweep_waiting_results(
    engine: AsyncEngine, store: ObjectStore, idle: timedelta = CHOICES_WAIT
) -> list[uuid.UUID]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    swept: list[uuid.UUID] = []
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            rows = (
                await connection.execute(
                    select(uploads)
                    .join(jobs, jobs.c.id == uploads.c.job_id)
                    .where(
                        uploads.c.kind == UploadKind.RESULT,
                        uploads.c.status == UploadStatus.COMPLETED,
                        uploads.c.result_set_id.is_(None),
                        uploads.c.import_problems.is_not(None),
                        uploads.c.import_choices.is_(None),
                        jobs.c.status == JobStatus.DONE,
                        uploads.c.last_activity_at < func.now() - idle,
                    )
                    .order_by(uploads.c.last_activity_at)
                    .with_for_update(of=uploads, skip_locked=True)
                )
            ).all()
            for row in rows:
                await connection.execute(
                    update(uploads)
                    .where(uploads.c.id == row.id)
                    .values(status=UploadStatus.EXPIRED, job_id=None, closed_at=func.now())
                )
                await store.delete_object(row.object_key)
                await record(
                    connection,
                    SYSTEM,
                    AuditAction.UPLOAD_EXPIRED,
                    AuditTarget.UPLOAD,
                    row.id,
                    tenant_id=tenant_id,
                    details={"project_id": str(row.project_id), "size_bytes": row.size_bytes},
                )
                swept.append(row.id)
    if swept:
        logger.info("waiting results swept", extra={"count": len(swept)})
    return swept


async def run_once(settings: ApiSettings) -> int:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(settings.storage(), http)
            aborted = await abort_stale_uploads(engine, store)
            swept = await sweep_waiting_results(engine, store)
            return len(aborted) + len(swept)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_once(load_settings(ApiSettings)))
