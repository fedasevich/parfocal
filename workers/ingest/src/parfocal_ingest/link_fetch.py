import asyncio
import hashlib
import json
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx2
from sqlalchemy import func, select, update

from parfocal_api.slide_ingest import upload_of
from parfocal_api.tables import UploadStatus, slides, uploads
from parfocal_api.uploads import close_upload
from parfocal_common.ingest import Failure
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.link_fetch import (
    LinkRefusal,
    LinkRefusedError,
    chunks_of,
    link_client,
    open_link,
    policy_of,
)
from parfocal_common.link_imports import KIND, LEASE_SECONDS, STEP_NAMES, LinkFailure, source_key
from parfocal_common.object_store import ObjectStore, StoredPart
from parfocal_common.result_imports import UploadKind
from parfocal_ingest.workflow import Resources, resources_from_environment

__all__ = ["LINK_FETCH", "link_fetch_workflow"]

CHUNK_BYTES = 1024 * 1024


@dataclass
class Parts:
    store: ObjectStore
    key: str
    storage_upload_id: str
    part_bytes: int
    stored: list[StoredPart] = field(default_factory=list[StoredPart])
    pending: bytearray = field(default_factory=bytearray)
    digest: Any = field(default_factory=hashlib.sha256)
    total: int = 0

    async def add(self, chunk: bytes) -> None:
        self.digest.update(chunk)
        self.total += len(chunk)
        self.pending.extend(chunk)
        while len(self.pending) >= self.part_bytes:
            await self.send(bytes(self.pending[: self.part_bytes]))
            del self.pending[: self.part_bytes]

    async def send(self, body: bytes) -> None:
        number = len(self.stored) + 1
        self.stored.append(
            await self.store.upload_part(self.key, self.storage_upload_id, number, body)
        )

    async def flush(self) -> None:
        if self.pending:
            await self.send(bytes(self.pending))
            self.pending.clear()


async def open_row(step: StepRun) -> Any:
    try:
        upload_id = uuid.UUID(str(step.input["upload_id"]))
    except KeyError, ValueError:
        raise StepFailedError(Failure.UPLOAD_MISSING) from None
    async with step.transaction() as connection:
        row = await upload_of(connection, upload_id)
    if row is None or row.status != UploadStatus.OPEN:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    return row


async def address_of(store: ObjectStore, row: Any) -> str:
    try:
        return str(json.loads(await store.get_object(source_key(row.tenant_id, row.id)))["address"])
    except (KeyError, ValueError) as error:
        raise StepFailedError(Failure.UPLOAD_MISSING) from error


async def fresh_parts(step: StepRun, store: ObjectStore, row: Any) -> Parts:
    await store.abort_multipart_upload(row.object_key, row.storage_upload_id)
    storage_upload_id = await store.create_multipart_upload(row.object_key)
    async with step.transaction() as connection:
        await connection.execute(
            update(uploads)
            .where(uploads.c.id == row.id)
            .values(storage_upload_id=storage_upload_id, last_activity_at=func.now())
        )
    return Parts(store, row.object_key, storage_upload_id, row.part_bytes)


async def download(
    step: StepRun, resources: Resources, store: ObjectStore, row: Any, address: str
) -> Parts:
    policy = policy_of(resources.link_trusted_origins, row.size_bytes)
    try:
        async with (
            asyncio.timeout(resources.link_fetch_seconds),
            link_client(resources.link_read_seconds) as client,
            open_link(client, address, policy) as opened,
        ):
            parts = await fresh_parts(step, store, row)
            async for chunk in chunks_of(opened.response, policy, CHUNK_BYTES):
                await parts.add(chunk)
            await parts.flush()
    except TimeoutError as error:
        raise StepFailedError(LinkRefusal.TIMEOUT) from error
    except LinkRefusedError as error:
        raise StepFailedError(error.code) from error
    return parts


async def duplicate(step: StepRun, row: Any, sha256: str) -> bool:
    if row.kind != UploadKind.SLIDE:
        return False
    async with step.transaction() as connection:
        found = await connection.scalar(
            select(slides.c.id)
            .where(
                slides.c.project_id == row.project_id,
                slides.c.sha256 == sha256,
                slides.c.deleted_at.is_(None),
            )
            .limit(1)
        )
    return found is not None


async def refuse(step: StepRun, store: ObjectStore, row: Any, code: str) -> None:
    current = row.storage_upload_id
    async with step.transaction() as connection:
        fresh = await upload_of(connection, row.id)
        if fresh is not None:
            current = fresh.storage_upload_id
        await connection.execute(
            update(uploads)
            .where(uploads.c.id == row.id, uploads.c.status == UploadStatus.OPEN)
            .values(status=UploadStatus.ABORTED, closed_at=func.now())
        )
    await store.abort_multipart_upload(row.object_key, current)
    await store.delete_object(source_key(row.tenant_id, row.id))
    raise StepFailedError(code)


async def fetch(step: StepRun, resources: Resources, store: ObjectStore) -> Mapping[str, Any]:
    row = await open_row(step)
    address = await address_of(store, row)
    try:
        parts = await download(step, resources, store, row, address)
    except StepFailedError as failure:
        await refuse(step, store, row, failure.code)
        raise
    if parts.total != row.size_bytes:
        await refuse(step, store, row, Failure.SIZE_MISMATCH)
    sha256 = parts.digest.hexdigest()
    if await duplicate(step, row, sha256):
        await refuse(step, store, row, LinkFailure.DUPLICATE)
    completed = await store.complete_multipart_upload(
        row.object_key, parts.storage_upload_id, parts.stored
    )
    async with step.transaction() as connection:
        current = await upload_of(connection, row.id)
        await close_upload(connection, current, completed.etag or None)
    await store.delete_object(source_key(row.tenant_id, row.id))
    return {"bytes": parts.total, "sha256": sha256}


def fetch_step(name: str, resources: Callable[[], Resources]) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        chosen = resources()
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            return await fetch(step, chosen, chosen.store_class(chosen.storage, http))

    return Step(name, run)


def link_fetch_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=KIND,
        steps=[fetch_step(name, resources) for name in STEP_NAMES],
        lease_seconds=lease_seconds,
    )


LINK_FETCH = link_fetch_workflow(resources_from_environment)
