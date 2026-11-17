import asyncio
import gzip
import io
import json
import logging
import struct
import uuid
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import httpx2
import tifffile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.settings import ApiSettings
from parfocal_api.tables import SlideStorage, slides, tenants
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.ingest import folder_of, slide_prefix
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.settings import load_settings
from parfocal_ingest.identify import identify
from parfocal_ingest.level_directories import (
    Directory,
    directory_of,
    directory_offsets,
    is_current,
    layout_of,
    located,
)
from parfocal_ingest.parse_jobs import LEVELS_OUTPUT
from parfocal_ingest.remote_inspect import BLOCK_BYTES, RangedFile, pyramid_in, tiles_in
from parfocal_ingest.workflow import TILE_INDEX_NAME

logger = logging.getLogger("parfocal.ingest.level_directories_backfill")

STORED = "stored"
INDEXED = "stored-from-original"
PRESENT = "present"
SKIPPED = "skipped"
FAILED = "failed"
NOT_FOUND = 404


@dataclass(frozen=True)
class StoredSlide:
    folder: str
    original_key: str | None


def stored_slide(
    tenant_id: uuid.UUID, slide_id: uuid.UUID, storage: str, original_key: str | None
) -> StoredSlide | None:
    if storage == SlideStorage.REMOTE:
        return StoredSlide(slide_prefix(tenant_id, slide_id), None)
    if original_key is None:
        return None
    return StoredSlide(folder_of(original_key), original_key)


async def optional_object(store: ObjectStore, key: str) -> bytes | None:
    try:
        return await store.get_stored_bytes(key)
    except StorageError as error:
        if error.status == NOT_FOUND:
            return None
        raise


def unpacked(body: bytes) -> Any:
    return json.loads(gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body)


async def stored_directories(
    store: ObjectStore, original_key: str, tiles: Mapping[str, Any]
) -> dict[int, Directory]:
    layout = layout_of(tiles)
    offsets = directory_offsets(tiles)
    heads = await asyncio.gather(
        *(store.get_range(original_key, offset, layout.count_bytes) for offset in offsets)
    )
    tables = await asyncio.gather(
        *(
            store.get_range(original_key, offset, layout.size(head))
            for offset, head in zip(offsets, heads, strict=True)
        )
    )
    return {
        offset: directory_of(layout, table) for offset, table in zip(offsets, tables, strict=True)
    }


def same_levels(table: Mapping[str, Any], tiles: Mapping[str, Any]) -> bool:
    levels = table.get("levels") or []
    indexed = tiles.get("levels") or []
    return len(levels) == len(indexed) and all(
        (level.get("width"), level.get("height")) == (entry.get("width"), entry.get("height"))
        for level, entry in zip(levels, indexed, strict=True)
    )


def tiles_of(source: RangedFile, name: str) -> dict[str, Any] | None:
    handle = io.BufferedReader(source, BLOCK_BYTES)
    identified = identify(handle, name)
    if identified.format is None:
        return None
    try:
        handle.seek(0)
        found = pyramid_in(handle, identified)
        return None if found is None else tiles_in(handle, identified, found)
    except tifffile.TiffFileError, ValueError, OSError, IndexError, struct.error:
        return None


async def original_tiles(store: ObjectStore, original_key: str) -> Any:
    size = await store.head_object(original_key)
    if size is None:
        return None
    loop = asyncio.get_running_loop()

    def read_at(start: int, length: int) -> bytes:
        return asyncio.run_coroutine_threadsafe(
            store.get_range(original_key, start, length), loop
        ).result()

    name = PurePosixPath(original_key).name
    return await asyncio.to_thread(tiles_of, RangedFile(read_at, size), name)


async def locate_levels(store: ObjectStore, slide: StoredSlide) -> str:
    table_key = f"{slide.folder}{LEVELS_OUTPUT}"
    table_body = await optional_object(store, table_key)
    if table_body is None:
        return SKIPPED
    table = unpacked(table_body)
    if is_current(table):
        return PRESENT
    tiles_body = await optional_object(store, f"{slide.folder}{TILE_INDEX_NAME}")
    if tiles_body is not None:
        tiles = unpacked(tiles_body)
    elif slide.original_key is not None:
        tiles = await original_tiles(store, slide.original_key)
        if tiles is None or not same_levels(table, tiles):
            return SKIPPED
    else:
        return SKIPPED
    directories = (
        {}
        if slide.original_key is None
        else await stored_directories(store, slide.original_key, tiles)
    )
    result = located(table, tiles, directories)
    if not is_current(result):
        return SKIPPED
    body = json.dumps(result, separators=(",", ":")).encode()
    await store.put_object(table_key, body, "application/json")
    return STORED if tiles_body is not None else INDEXED


async def backfill(engine: AsyncEngine, store: ObjectStore) -> Counter[str]:
    outcomes: Counter[str] = Counter()
    done: set[str] = set()
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            rows = (
                await connection.execute(
                    select(slides.c.id, slides.c.storage, slides.c.original_key).where(
                        slides.c.deleted_at.is_(None), slides.c.file_bytes.is_not(None)
                    )
                )
            ).all()
        for row in rows:
            slide = stored_slide(tenant_id, row.id, row.storage, row.original_key)
            if slide is None or slide.folder in done:
                outcomes[SKIPPED if slide is None else PRESENT] += 1
                continue
            done.add(slide.folder)
            try:
                outcomes[await locate_levels(store, slide)] += 1
            except Exception:
                logger.exception(
                    "level directories backfill failed", extra={"slide_id": str(row.id)}
                )
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


def main() -> dict[str, int]:
    outcomes = dict(asyncio.run(run_once(load_settings(ApiSettings))))
    print(outcomes)
    return outcomes


if __name__ == "__main__":
    main()
