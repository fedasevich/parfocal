import asyncio
import logging
import tempfile
import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
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
from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, read_pyramid, unpack
from parfocal_ingest.thumbnail import coarse_level_thumbnail, previews

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
        if identified.format is Format.VENTANA_BIF:
            return coarse_level_thumbnail(path)
        raise NoThumbnailError(f"{path.name} has no readable pyramid ({found})")
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


def skip_reason(original_key: str | None, file_bytes: int | None) -> str:
    if original_key is None:
        return "no original file"
    if file_bytes is None:
        return "upload not finished"
    return "tenant upload, not parsed here"


@dataclass
class Report:
    outcomes: Counter[str] = field(default_factory=Counter)
    reasons: Counter[tuple[str, str]] = field(default_factory=Counter)

    def add(self, state: str, reason: str | None = None) -> None:
        self.outcomes[state] += 1
        if reason is not None:
            self.reasons[(state, reason)] += 1

    def lines(self) -> list[str]:
        order = (STORED, COPIED, PRESENT, SKIPPED, FAILED)
        counts = ", ".join(f"{state} {self.outcomes[state]}" for state in order)
        details = [
            f"  {state}: {count} x {reason}"
            for (state, reason), count in sorted(self.reasons.items())
        ]
        return [counts, *details]


async def backfill(engine: AsyncEngine, store: ObjectStore) -> Report:
    report = Report()
    made: dict[str, bytes] = {}
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids: Sequence[uuid.UUID] = list(
            await connection.scalars(select(tenants.c.id).order_by(tenants.c.id))
        )
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            rows = (
                await connection.execute(
                    select(slides.c.id, slides.c.original_key, slides.c.file_bytes).where(
                        slides.c.deleted_at.is_(None)
                    )
                )
            ).all()
        for row in rows:
            if row.original_key is None or row.file_bytes is None:
                report.add(SKIPPED, skip_reason(row.original_key, row.file_bytes))
                continue
            try:
                state = await ensure_thumbnail(store, tenant_id, row.id, row.original_key, made)
                reason = skip_reason(row.original_key, row.file_bytes)
                report.add(state, reason if state == SKIPPED else None)
            except Exception as error:
                logger.exception("thumbnail backfill failed", extra={"slide_id": str(row.id)})
                report.add(FAILED, f"{type(error).__name__}: {error}"[:160])
    return report


async def run_once(settings: ApiSettings) -> Report:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        async with httpx2.AsyncClient(timeout=120) as http:
            return await backfill(engine, ObjectStore(settings.storage(), http))
    finally:
        await engine.dispose()


def main() -> list[str]:
    report = asyncio.run(run_once(load_settings(ApiSettings)))
    lines = report.lines()
    print("\n".join(lines))
    return lines


if __name__ == "__main__":
    main()
