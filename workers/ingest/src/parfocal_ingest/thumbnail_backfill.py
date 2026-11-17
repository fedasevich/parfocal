import asyncio
import logging
import tempfile
import uuid
from collections import Counter
from collections.abc import Sequence
from pathlib import Path, PurePosixPath

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
from parfocal_common.ingest import FIXTURES_PREFIX, folder_of, slide_prefix
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import load_settings
from parfocal_ingest.identify import identify
from parfocal_ingest.pyramid import Pyramid, read_pyramid, unpack
from parfocal_ingest.thumbnail import previews

logger = logging.getLogger("parfocal.ingest.thumbnail_backfill")

THUMBNAIL_FILE = "thumbnail.jpg"
TENANT_FOLDER = "t/"
STORED = "stored"
COPIED = "copied"
PRESENT = "present"
SKIPPED = "skipped"
FAILED = "failed"


class NoThumbnailError(Exception):
    pass


def trusted_original(original_key: str | None) -> bool:
    return original_key is not None and not original_key.startswith(TENANT_FOLDER)


def thumbnail_from(path: Path, work: Path) -> bytes:
    with path.open("rb") as handle:
        identified = identify(handle, path.name)
    if identified.format is None:
        raise NoThumbnailError(f"{path.name} is not a slide this app reads")
    if identified.variant == "zip":
        unpacked = unpack(path, work / "unpacked", identified.format)
        if not isinstance(unpacked, Path):
            raise NoThumbnailError(f"{path.name} holds no single slide")
        path = unpacked
    found = read_pyramid(path, identified)
    if not isinstance(found, Pyramid):
        raise NoThumbnailError(f"{path.name} has no readable pyramid")
    return previews(path, identified.format, found).thumbnail


async def derived_beside(store: ObjectStore, original_key: str) -> bytes | None:
    folder = folder_of(original_key)
    if folder == FIXTURES_PREFIX:
        return None
    key = f"{folder}{THUMBNAIL_FILE}"
    if await store.head_object(key) is None:
        return None
    return await store.get_object(key)


async def render(store: ObjectStore, original_key: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="thumbnail-backfill-") as folder:
        work = Path(folder)
        local = work / PurePosixPath(original_key).name
        await store.download(original_key, local)
        return await asyncio.to_thread(thumbnail_from, local, work)


async def ensure_thumbnail(
    store: ObjectStore,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    original_key: str | None,
    made: dict[str, bytes],
) -> str:
    if not trusted_original(original_key):
        return SKIPPED
    assert original_key is not None
    key = f"{slide_prefix(tenant_id, slide_id)}{THUMBNAIL_FILE}"
    if await store.head_object(key) is not None:
        return PRESENT
    body = made.get(original_key)
    state = COPIED
    if body is None:
        body = await derived_beside(store, original_key)
    if body is None:
        body = await render(store, original_key)
        state = STORED
    made[original_key] = body
    await store.put_object(key, body, "image/jpeg")
    return state


async def backfill(engine: AsyncEngine, store: ObjectStore) -> Counter[str]:
    outcomes: Counter[str] = Counter()
    made: dict[str, bytes] = {}
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
        for row in rows:
            try:
                state = await ensure_thumbnail(store, tenant_id, row.id, row.original_key, made)
                outcomes[state] += 1
            except Exception:
                logger.exception("thumbnail backfill failed", extra={"slide_id": str(row.id)})
                outcomes[FAILED] += 1
    return outcomes


async def run_once(settings: ApiSettings) -> Counter[str]:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        async with httpx2.AsyncClient(timeout=120) as http:
            return await backfill(engine, ObjectStore(settings.storage(), http))
    finally:
        await engine.dispose()


def main() -> None:
    outcomes = asyncio.run(run_once(load_settings(ApiSettings)))
    print(dict(outcomes))


if __name__ == "__main__":
    main()
