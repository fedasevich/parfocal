import asyncio
import gzip
import io
import re
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any, BinaryIO

import httpx2
import tifffile
from sqlalchemy import func, select, update

from parfocal_api.audit import AuditAction, AuditTarget, record
from parfocal_api.remote_reads import (
    Pinned,
    Remote,
    cache_prefix,
    fetch_range,
    same_file,
    source_reach,
)
from parfocal_api.retention import SYSTEM
from parfocal_api.tables import SlideStorage, slides
from parfocal_common.ingest import Failure, original_key, restricted_ranges_key, slide_prefix
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.link_fetch import LinkPolicy, LinkRefusal, LinkRefusedError, policy_of
from parfocal_common.object_store import ObjectStore, StoredPart
from parfocal_common.remote_inspect import (
    COPY_KIND,
    COPY_STEP_NAMES,
    KIND,
    LEASE_SECONDS,
    STEP_NAMES,
)
from parfocal_ingest.identify import Format, Identified, identify
from parfocal_ingest.identifying_text import ranges_file_of
from parfocal_ingest.parse_jobs import LEVELS_OUTPUT, level_table
from parfocal_ingest.pyramid import (
    Pyramid,
    Reader,
    Scale,
    ladder,
    main_series,
    number,
    ome_scale,
    plane_count,
    pyramid,
    scale_of,
    stored_level,
)
from parfocal_ingest.tile_index import index_document, tile_index
from parfocal_ingest.workflow import TILE_INDEX_NAME, Resources, resources_from_environment

__all__ = [
    "REMOTE_COPY",
    "REMOTE_INSPECT",
    "RangedFile",
    "remote_copy_workflow",
    "remote_inspect_workflow",
]

BLOCK_BYTES = 256 * 1024
KEPT_BLOCKS = 64
READ_IN_PLACE = frozenset({Format.APERIO_SVS, Format.GENERIC_TIFF, Format.OME_TIFF})
REMOTE_FORMAT = "remote-format"
REMOTE_CHANGED = "remote-slide-changed"
REMOTE_NOT_READY = "remote-slide-not-ready"
COPY_PART_BYTES = 16 * 1024 * 1024

type ReadAt = Callable[[int, int], bytes]


class RangedFile(io.RawIOBase):
    def __init__(self, read_at: ReadAt, size: int, block_bytes: int = BLOCK_BYTES) -> None:
        super().__init__()
        self.read_at = read_at
        self.size = size
        self.block_bytes = block_bytes
        self.position = 0
        self.blocks: OrderedDict[int, bytes] = OrderedDict()

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.position, io.SEEK_END: self.size}[whence]
        self.position = max(0, base + offset)
        return self.position

    def block(self, index: int) -> bytes:
        if index in self.blocks:
            self.blocks.move_to_end(index)
            return self.blocks[index]
        start = index * self.block_bytes
        data = self.read_at(start, min(self.block_bytes, self.size - start))
        self.blocks[index] = data
        if len(self.blocks) > KEPT_BLOCKS:
            self.blocks.popitem(last=False)
        return data

    def readinto(self, buffer: Any) -> int:
        view = memoryview(buffer).cast("B")
        wanted = min(len(view), max(0, self.size - self.position))
        done = 0
        while done < wanted:
            index, within = divmod(self.position, self.block_bytes)
            data = self.block(index)[within : within + wanted - done]
            view[done : done + len(data)] = data
            done += len(data)
            self.position += len(data)
        return done


@dataclass(frozen=True)
class Inspected:
    format: Format
    variant: str | None
    pyramid: Pyramid
    levels: bytes
    tiles: bytes | None
    ranges: bytes

    @property
    def width(self) -> int:
        return self.pyramid.levels[0].width

    @property
    def height(self) -> int:
        return self.pyramid.levels[0].height


def svs_value(description: str, name: str) -> float | None:
    found = re.search(rf"\|\s*{name}\s*=\s*([0-9]*\.?[0-9]+)", description)
    return None if found is None else number(found.group(1))


def svs_scale(description: str) -> Scale:
    mpp = svs_value(description, "MPP")
    return scale_of(mpp, mpp, svs_value(description, "AppMag"))


def scale_in(tiff: tifffile.TiffFile, series: tifffile.TiffPageSeries, chosen: Format) -> Scale:
    if chosen is Format.OME_TIFF:
        return ome_scale(tiff, tiff.series.index(series))
    if chosen is Format.APERIO_SVS:
        return svs_scale(tiff.pages.first.description or "")
    return scale_of(None, None, None)


def pyramid_in(handle: BinaryIO, identified: Identified) -> Pyramid | None:
    assert identified.format is not None
    with tifffile.TiffFile(handle) as tiff:
        series = main_series(tiff)
        if series is None:
            return None
        levels, skipped = ladder([stored_level(level) for level in series.levels])
        scale = scale_in(tiff, series, identified.format)
        return pyramid(Reader.TIFFFILE, levels, scale, plane_count(series), skipped)


def tiles_in(handle: BinaryIO, identified: Identified, found: Pyramid) -> bytes | None:
    handle.seek(0)
    tiles = tile_index(handle, identified, found)
    return None if tiles is None else gzip.compress(index_document(tiles), mtime=0)


def inspected(source: RangedFile, name: str) -> Inspected | str:
    handle = io.BufferedReader(source, BLOCK_BYTES)
    found = identify(handle, name)
    if found.format is None:
        return str(found.refusal)
    if found.format not in READ_IN_PLACE:
        return REMOTE_FORMAT
    handle.seek(0)
    try:
        levels = pyramid_in(handle, found)
        if levels is None:
            return REMOTE_FORMAT
        tiles = tiles_in(handle, found, levels)
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return REMOTE_FORMAT
    handle.seek(0)
    ranges = ranges_file_of(handle, source.size, PurePosixPath(name).suffix)
    return Inspected(found.format, found.variant, levels, level_table(levels), tiles, ranges)


def reader_of(
    remote: Remote, policy: LinkPolicy, seconds: float, loop: asyncio.AbstractEventLoop
) -> ReadAt:
    def read_at(offset: int, length: int) -> bytes:
        work = fetch_range(remote, policy, seconds, offset, length)
        return asyncio.run_coroutine_threadsafe(work, loop).result()[0]

    return read_at


async def slide_of(step: StepRun) -> Any:
    try:
        slide_id = uuid.UUID(str(step.input["slide_id"]))
    except KeyError, ValueError:
        raise StepFailedError(Failure.UPLOAD_MISSING) from None
    async with step.transaction() as connection:
        row = (
            await connection.execute(
                select(slides).where(
                    slides.c.id == slide_id,
                    slides.c.storage == SlideStorage.REMOTE,
                    slides.c.deleted_at.is_(None),
                )
            )
        ).first()
    if row is None or row.file_bytes is None:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    return row


async def inspect(step: StepRun, resources: Resources, store: ObjectStore) -> Mapping[str, Any]:
    row = await slide_of(step)
    if resources.keyring is None:
        raise StepFailedError(LinkRefusal.STATUS)
    try:
        async with step.transaction() as connection:
            remote = await source_reach(
                connection,
                resources.keyring,
                row.tenant_id,
                row.source_id,
                row.remote_path,
                datetime.now(UTC),
            )
        read_at = reader_of(
            remote,
            policy_of(resources.link_trusted_origins),
            resources.link_read_seconds,
            asyncio.get_running_loop(),
        )
        handle = RangedFile(read_at, row.file_bytes)
        found = await asyncio.to_thread(inspected, handle, row.remote_path)
    except LinkRefusedError as error:
        raise StepFailedError(error.code) from error
    if isinstance(found, str):
        raise StepFailedError(found)
    prefix = slide_prefix(row.tenant_id, row.id)
    await store.put_object(f"{prefix}{LEVELS_OUTPUT}", found.levels, "application/json")
    if found.tiles is not None:
        await store.put_object(
            f"{prefix}{TILE_INDEX_NAME}", found.tiles, "application/json", content_encoding="gzip"
        )
    await store.put_object(
        restricted_ranges_key(row.tenant_id, row.id), found.ranges, "application/json"
    )
    async with step.transaction() as connection:
        await connection.execute(
            update(slides)
            .where(slides.c.id == row.id)
            .values(
                format=found.format.value,
                variant=found.variant,
                width=found.width,
                height=found.height,
                level_count=len(found.pyramid.levels),
                published_at=func.coalesce(slides.c.published_at, func.now()),
            )
        )
        await record(
            connection,
            SYSTEM,
            AuditAction.SLIDE_PUBLISHED,
            AuditTarget.SLIDE,
            row.id,
            tenant_id=row.tenant_id,
            details={
                "project_id": str(row.project_id),
                "format": found.format.value,
                "file_bytes": row.file_bytes,
                "storage": SlideStorage.REMOTE.value,
            },
        )
    return {
        "format": found.format.value,
        "levels": len(found.pyramid.levels),
        "tile_index": found.tiles is not None,
    }


async def copied(
    store: ObjectStore, key: str, remote: Remote, pinned: Pinned, policy: LinkPolicy, seconds: float
) -> None:
    upload_id = await store.create_multipart_upload(key)
    try:
        parts: list[StoredPart] = []
        for number, offset in enumerate(range(0, pinned.size, COPY_PART_BYTES), start=1):
            length = min(COPY_PART_BYTES, pinned.size - offset)
            body, found = await fetch_range(remote, policy, seconds, offset, length)
            if not same_file(pinned, found):
                raise StepFailedError(REMOTE_CHANGED)
            parts.append(await store.upload_part(key, upload_id, number, body))
        await store.complete_multipart_upload(key, upload_id, parts)
    except BaseException:
        await store.abort_multipart_upload(key, upload_id)
        raise


async def drop_cache(store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> None:
    for key in await store.list_keys(cache_prefix(tenant_id, slide_id)):
        await store.delete_object(key)


async def copy_in(step: StepRun, resources: Resources, store: ObjectStore) -> Mapping[str, Any]:
    row = await slide_of(step)
    if row.published_at is None:
        raise StepFailedError(REMOTE_NOT_READY)
    if resources.keyring is None:
        raise StepFailedError(LinkRefusal.STATUS)
    key = original_key(row.tenant_id, row.id, row.remote_path)
    pinned = Pinned(row.file_bytes, row.remote_etag)
    try:
        async with step.transaction() as connection:
            remote = await source_reach(
                connection,
                resources.keyring,
                row.tenant_id,
                row.source_id,
                row.remote_path,
                datetime.now(UTC),
            )
        await copied(
            store,
            key,
            remote,
            pinned,
            policy_of(resources.link_trusted_origins),
            resources.link_read_seconds,
        )
    except TimeoutError as error:
        raise StepFailedError(LinkRefusal.TIMEOUT) from error
    except LinkRefusedError as error:
        raise StepFailedError(error.code) from error
    async with step.transaction() as connection:
        await connection.execute(
            update(slides)
            .where(slides.c.id == row.id, slides.c.storage == SlideStorage.REMOTE)
            .values(
                storage=SlideStorage.UPLOADED,
                original_key=key,
                source_id=None,
                remote_path=None,
                remote_etag=None,
                remote_failures=0,
                remote_failing_since=None,
                remote_read_at=None,
            )
        )
        await record(
            connection,
            SYSTEM,
            AuditAction.SLIDE_COPIED_IN,
            AuditTarget.SLIDE,
            row.id,
            tenant_id=row.tenant_id,
            details={"project_id": str(row.project_id), "file_bytes": row.file_bytes},
        )
    await drop_cache(store, row.tenant_id, row.id)
    return {"file_bytes": row.file_bytes}


type StepWork = Callable[[StepRun, Resources, ObjectStore], Awaitable[Mapping[str, Any]]]


def store_step(name: str, resources: Callable[[], Resources], work: StepWork) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        chosen = resources()
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            return await work(step, chosen, chosen.store_class(chosen.storage, http))

    return Step(name, run)


def inspect_step(name: str, resources: Callable[[], Resources]) -> Step:
    return store_step(name, resources, inspect)


def remote_copy_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=COPY_KIND,
        steps=[store_step(name, resources, copy_in) for name in COPY_STEP_NAMES],
        lease_seconds=lease_seconds,
    )


def remote_inspect_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=KIND,
        steps=[inspect_step(name, resources) for name in STEP_NAMES],
        lease_seconds=lease_seconds,
    )


REMOTE_INSPECT = remote_inspect_workflow(resources_from_environment)
REMOTE_COPY = remote_copy_workflow(resources_from_environment)
