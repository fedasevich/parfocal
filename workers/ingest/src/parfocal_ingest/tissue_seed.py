import asyncio
import json
import logging
import tempfile
import time
import uuid
from collections import Counter, defaultdict
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from sqlalchemy import select

from parfocal_api.showcase_timing import took
from parfocal_api.tables import slides
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.ingest import FIXTURES_PREFIX, folder_of, slide_prefix
from parfocal_common.jobs import StepFailedError
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_ingest.parse_jobs import READER_ERRORS, identify_file, unpacked_in
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.thumbnail_backfill import trusted_original
from parfocal_ingest.tissue import tissue_mask
from parfocal_ingest.workflow import tissue_facts

logger = logging.getLogger("parfocal.ingest.tissue_seed")

MASK_FILE = "tissue.png"
FACTS_FILE = "tissue.json"
STORED = "stored"
COPIED = "copied"
PRESENT = "present"
MISSING = "missing"
UNREADABLE = "unreadable"
NOT_FOUND = 404
CONCURRENCY = 8


class NoMaskError(Exception):
    pass


@dataclass(frozen=True)
class SeededSlide:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    original_key: str

    @property
    def prefix(self) -> str:
        return slide_prefix(self.tenant_id, self.slide_id)


@dataclass(frozen=True)
class MaskFiles:
    mask: bytes
    facts: bytes


def mask_files_from(path: Path, work: Path) -> MaskFiles:
    identified = identify_file(path, path.name)
    if identified.format is None:
        raise NoMaskError(f"{path.name} is not a slide this app reads")
    readable = unpacked_in(work, path, identified)
    found = read_pyramid(readable, identified)
    if not isinstance(found, Pyramid):
        raise NoMaskError(f"{path.name} has no readable pyramid ({found})")
    mask = tissue_mask(readable, identified.format, found)
    return MaskFiles(mask.png(), json.dumps(tissue_facts(mask.facts())).encode())


async def optional(store: ObjectStore, key: str) -> bytes | None:
    try:
        return await store.get_object(key)
    except StorageError as error:
        if error.status != NOT_FOUND:
            raise
        return None


def beside_folder(original_key: str) -> str | None:
    folder = folder_of(original_key)
    return None if folder == FIXTURES_PREFIX else folder


async def kept_beside(store: ObjectStore, original_key: str) -> MaskFiles | None:
    folder = beside_folder(original_key)
    if folder is None:
        return None
    mask = await optional(store, f"{folder}{MASK_FILE}")
    facts = await optional(store, f"{folder}{FACTS_FILE}")
    return None if mask is None or facts is None else MaskFiles(mask, facts)


async def keep_beside(store: ObjectStore, original_key: str, files: MaskFiles) -> None:
    folder = beside_folder(original_key)
    if folder is not None:
        await store.put_object(f"{folder}{FACTS_FILE}", files.facts, "application/json")
        await store.put_object(f"{folder}{MASK_FILE}", files.mask, "image/png")


async def rendered(store: ObjectStore, original_key: str) -> MaskFiles | str:
    with tempfile.TemporaryDirectory(prefix="tissue-seed-") as folder:
        work = Path(folder)
        local = work / PurePosixPath(original_key).name
        try:
            await store.download(original_key, local)
        except StorageError as error:
            if error.status != NOT_FOUND:
                raise
            return MISSING
        try:
            return await asyncio.to_thread(mask_files_from, local, work)
        except (NoMaskError, StepFailedError, *READER_ERRORS) as error:
            logger.warning("no tissue mask for a seeded original", extra={"error": str(error)})
            return UNREADABLE


async def files_for(store: ObjectStore, original_key: str) -> tuple[str, MaskFiles | None]:
    kept = await kept_beside(store, original_key)
    if kept is not None:
        return COPIED, kept
    made = await rendered(store, original_key)
    if isinstance(made, str):
        return made, None
    await keep_beside(store, original_key, made)
    return STORED, made


async def bounded[T](calls: Sequence[Callable[[], Awaitable[T]]]) -> list[T]:
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(call: Callable[[], Awaitable[T]]) -> T:
        async with gate:
            return await call()

    return await asyncio.gather(*(one(call) for call in calls))


async def seeded_slides(database_url: str, tenant_ids: Sequence[uuid.UUID]) -> list[SeededSlide]:
    engine = create_engine(database_url)
    found: list[SeededSlide] = []
    try:
        for tenant_id in tenant_ids:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
                rows = await connection.execute(
                    select(slides.c.id, slides.c.original_key)
                    .where(
                        slides.c.tenant_id == tenant_id,
                        slides.c.deleted_at.is_(None),
                        slides.c.original_key.is_not(None),
                        slides.c.file_bytes.is_not(None),
                    )
                    .order_by(slides.c.id)
                )
                found.extend(
                    SeededSlide(tenant_id, row.id, row.original_key)
                    for row in rows
                    if trusted_original(row.original_key)
                )
    finally:
        await engine.dispose()
    return found


async def give_mask(store: ObjectStore, slide: SeededSlide, files: MaskFiles) -> None:
    await store.put_object(f"{slide.prefix}{FACTS_FILE}", files.facts, "application/json")
    await store.put_object(f"{slide.prefix}{MASK_FILE}", files.mask, "image/png")


async def give_masks(store: ObjectStore, group: Sequence[SeededSlide], files: MaskFiles) -> None:
    await bounded([lambda slide=slide: give_mask(store, slide, files) for slide in group])


async def store_seeded_masks(
    database_url: str, store: ObjectStore, tenant_ids: Sequence[uuid.UUID]
) -> Counter[str]:
    started = time.monotonic()
    outcomes: Counter[str] = Counter()
    found = await seeded_slides(database_url, tenant_ids)
    heads = await bounded(
        [lambda slide=slide: store.head_object(f"{slide.prefix}{MASK_FILE}") for slide in found]
    )
    waiting: defaultdict[str, list[SeededSlide]] = defaultdict(list)
    for slide, head in zip(found, heads, strict=True):
        if head is None:
            waiting[slide.original_key].append(slide)
        else:
            outcomes[PRESENT] += 1
    for original_key, group in waiting.items():
        state, files = await files_for(store, original_key)
        outcomes[state] += len(group)
        if files is not None:
            await give_masks(store, group, files)
    took("tissue masks", started)
    return outcomes
