import asyncio
import io
import uuid
from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

import httpx2
import tifffile
from sqlalchemy import func, select, update

from parfocal_api.audit import AuditAction, AuditTarget, record
from parfocal_api.remote_reads import Remote, fetch_range, source_reach
from parfocal_api.retention import SYSTEM
from parfocal_api.tables import SlideStorage, slides
from parfocal_common.ingest import Failure, restricted_ranges_key
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.link_fetch import LinkPolicy, LinkRefusal, LinkRefusedError, policy_of
from parfocal_common.object_store import ObjectStore
from parfocal_common.remote_inspect import KIND, LEASE_SECONDS, STEP_NAMES
from parfocal_ingest.identify import Format, identify
from parfocal_ingest.identifying_text import ranges_file_of
from parfocal_ingest.pyramid import main_series, stored_level
from parfocal_ingest.workflow import Resources, resources_from_environment

__all__ = ["REMOTE_INSPECT", "RangedFile", "remote_inspect_workflow"]

BLOCK_BYTES = 256 * 1024
KEPT_BLOCKS = 64
READ_IN_PLACE = frozenset({Format.APERIO_SVS, Format.GENERIC_TIFF, Format.OME_TIFF})
REMOTE_FORMAT = "remote-format"

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
    width: int
    height: int
    level_count: int
    ranges: bytes


def inspected(raw: RangedFile, name: str) -> Inspected | str:
    handle = io.BufferedReader(raw, raw.block_bytes)
    found = identify(handle, name)
    if found.format is None:
        return str(found.refusal)
    if found.format not in READ_IN_PLACE:
        return REMOTE_FORMAT
    handle.seek(0)
    try:
        with tifffile.TiffFile(handle) as tiff:
            series = main_series(tiff)
            if series is None:
                return REMOTE_FORMAT
            base = stored_level(series.levels[0])
            levels = len(series.levels)
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return REMOTE_FORMAT
    handle.seek(0)
    ranges = ranges_file_of(handle, raw.size, PurePosixPath(name).suffix)
    return Inspected(found.format, found.variant, base.width, base.height, levels, ranges)


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
                level_count=found.level_count,
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
    return {"format": found.format.value, "levels": found.level_count}


def inspect_step(name: str, resources: Callable[[], Resources]) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        chosen = resources()
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            return await inspect(step, chosen, chosen.store_class(chosen.storage, http))

    return Step(name, run)


def remote_inspect_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=KIND,
        steps=[inspect_step(name, resources) for name in STEP_NAMES],
        lease_seconds=lease_seconds,
    )


REMOTE_INSPECT = remote_inspect_workflow(resources_from_environment)
