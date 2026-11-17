import asyncio
import logging
import tempfile
import uuid
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import httpx2
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.settings import ApiSettings
from parfocal_api.tables import slides, tenants
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import load_settings
from parfocal_ingest.cell_crops import crop_slide, picked_on

logger = logging.getLogger("parfocal.ingest.cell_crops_backfill")

FAILED = "failed"


async def backfill(engine: AsyncEngine, store: ObjectStore, work_dir: Path) -> Counter[str]:
    outcomes: Counter[str] = Counter()
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids: Sequence[uuid.UUID] = list(
            await connection.scalars(select(tenants.c.id).order_by(tenants.c.id))
        )
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            rows = (
                await connection.execute(
                    select(slides.c.id, slides.c.original_key).where(
                        slides.c.deleted_at.is_(None),
                        slides.c.original_key.is_not(None),
                        slides.c.file_bytes.is_not(None),
                    )
                )
            ).all()
            picks = {row.id: await picked_on(connection, store, tenant_id, row.id) for row in rows}
        for row in rows:
            try:
                state = await crop_slide(
                    store, tenant_id, row.id, row.original_key, picks[row.id], work_dir
                )
                outcomes[state] += 1
            except Exception:
                logger.exception("cell crop backfill failed", extra={"slide_id": str(row.id)})
                outcomes[FAILED] += 1
    return outcomes


async def run_once(settings: ApiSettings) -> Counter[str]:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        async with httpx2.AsyncClient(timeout=120) as http:
            with tempfile.TemporaryDirectory(prefix="cell-crops-backfill-") as folder:
                return await backfill(engine, ObjectStore(settings.storage(), http), Path(folder))
    finally:
        await engine.dispose()


def main() -> None:
    outcomes = asyncio.run(run_once(load_settings(ApiSettings)))
    print(dict(outcomes))


if __name__ == "__main__":
    main()
