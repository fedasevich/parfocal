import hashlib
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
from sqlalchemy import func, select, update
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.identifiers import load_keys
from parfocal_api.import_sources import bucket_and_prefix, credential_of, location_of
from parfocal_api.problems import ConflictError
from parfocal_api.tables import ImportSourceKind, SlideStorage, import_sources, slides
from parfocal_common.envelope import MasterKeyring
from parfocal_common.ingest import slide_prefix
from parfocal_common.link_fetch import (
    LinkPolicy,
    LinkRefusal,
    LinkRefusedError,
    chunks_of,
    link_client,
    open_link,
)
from parfocal_common.object_store import ObjectStore, StorageError, presign

CACHE_DAYS = 7
OFFLINE_AFTER_FAILURES = 3
READ_MARK = timedelta(hours=1)
SIGNED_SECONDS = 300
MAX_RANGE_BYTES = 16 * 1024 * 1024
CACHE_FOLDER = "remote-cache/"
CHUNK_BYTES = 256 * 1024
CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")
MAX_FAILURES = 32_000


class RemoteSlideChangedError(ConflictError):
    code = "remote-slide-changed"
    title = "The file at the source changed since the slide was opened in place"


@dataclass(frozen=True)
class Remote:
    url: str
    headers: Mapping[str, str] = field(default_factory=dict[str, str])


@dataclass(frozen=True)
class Pinned:
    size: int
    etag: str | None


def clean_path(path: str) -> str | None:
    parts = path.split("/")
    if not path or path.startswith("/") or any(part in ("", ".", "..") for part in parts):
        return None
    if any(char in path for char in "?#\\") or any(ord(char) < 0x20 for char in path):
        return None
    return path


def remote_path_of(source: Row[Any], file_url: str) -> str | None:
    if source.kind == ImportSourceKind.HTTPS:
        address = source.address
        if not file_url.startswith(address):
            return None
        return clean_path(file_url[len(address) :])
    url = httpx2.URL(source.address)
    bucket, prefix = bucket_and_prefix(url)
    key = httpx2.URL(file_url).path.removeprefix(f"/{bucket}/")
    if not key.startswith(prefix):
        return None
    return clean_path(key[len(prefix) :])


def remote_of(source: Row[Any], credential: Any, path: str, now: datetime) -> Remote:
    if source.kind == ImportSourceKind.HTTPS:
        headers = (
            {source.header_name: credential.secret}
            if credential is not None and source.header_name
            else {}
        )
        return Remote(f"{source.address}{path}", headers)
    if credential is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    _, prefix = bucket_and_prefix(httpx2.URL(source.address))
    location = location_of(source, credential)
    return Remote(presign(location, "GET", f"{prefix}{path}", {}, SIGNED_SECONDS, now))


async def source_reach(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    tenant_id: uuid.UUID,
    source_id: uuid.UUID | None,
    path: str,
    now: datetime,
) -> Remote:
    if source_id is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    source = (
        await connection.execute(select(import_sources).where(import_sources.c.id == source_id))
    ).first()
    if source is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    credential = None
    if source.credential_ciphertext is not None:
        credential = credential_of(await load_keys(connection, keyring, tenant_id), source)
    return remote_of(source, credential, path, now)


def etag_of(response: httpx2.Response) -> str | None:
    value = response.headers.get("etag")
    if value:
        return value.removeprefix("W/").strip('"')[:200] or None
    modified = response.headers.get("last-modified")
    return f"modified:{modified}"[:200] if modified else None


def total_of(response: httpx2.Response, offset: int, length: int) -> int:
    found = CONTENT_RANGE.match(response.headers.get("content-range", ""))
    if response.status_code != 206 or found is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    first, last, total = (int(value) for value in found.groups())
    if first != offset or last != offset + length - 1:
        raise LinkRefusedError(LinkRefusal.STATUS)
    return total


async def fetch_range(
    remote: Remote, policy: LinkPolicy, seconds: float, offset: int, length: int
) -> tuple[bytes, Pinned]:
    headers = {**remote.headers, "range": f"bytes={offset}-{offset + length - 1}"}
    capped = LinkPolicy(policy.trusted_origins, length)
    async with (
        link_client(seconds) as client,
        open_link(client, remote.url, capped, "GET", headers) as opened,
    ):
        total = total_of(opened.response, offset, length)
        body = b"".join([chunk async for chunk in chunks_of(opened.response, capped, CHUNK_BYTES)])
        if len(body) != length:
            raise LinkRefusedError(LinkRefusal.STATUS)
        return body, Pinned(total, etag_of(opened.response))


async def probe(remote: Remote, policy: LinkPolicy, seconds: float) -> Pinned:
    _, pinned = await fetch_range(remote, policy, seconds, 0, 1)
    return pinned


def same_file(pinned: Pinned, found: Pinned) -> bool:
    if pinned.size != found.size:
        return False
    return pinned.etag is None or found.etag is None or pinned.etag == found.etag


def cache_tag(pinned: Pinned) -> str:
    return hashlib.sha256(f"{pinned.etag or ''}:{pinned.size}".encode()).hexdigest()[:24]


def cache_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"{slide_prefix(tenant_id, slide_id)}{CACHE_FOLDER}"


def cache_key(
    tenant_id: uuid.UUID, slide_id: uuid.UUID, pinned: Pinned, offset: int, length: int
) -> str:
    return f"{cache_prefix(tenant_id, slide_id)}{cache_tag(pinned)}/{offset}-{length}"


async def cached(store: ObjectStore, key: str) -> bytes | None:
    try:
        return await store.get_object(key)
    except StorageError as error:
        if error.status == 404:
            return None
        raise


def served_name(path: str) -> str:
    name = SAFE_NAME.sub("_", path.rsplit("/", 1)[-1]).lstrip("._-")
    return (name or "slide")[:100]


def is_offline(row: Any) -> bool:
    return row.source_id is None or row.remote_failures >= OFFLINE_AFTER_FAILURES


async def mark_read(connection: AsyncConnection, slide_id: uuid.UUID, now: datetime) -> None:
    await connection.execute(
        update(slides)
        .where(
            slides.c.id == slide_id,
            (slides.c.remote_read_at.is_(None)) | (slides.c.remote_read_at < now - READ_MARK),
        )
        .values(remote_read_at=now)
    )


async def mark_reached(connection: AsyncConnection, slide_id: uuid.UUID, now: datetime) -> None:
    await connection.execute(
        update(slides)
        .where(slides.c.id == slide_id, slides.c.remote_failures > 0)
        .values(remote_failures=0, remote_failing_since=None)
    )
    await mark_read(connection, slide_id, now)


async def mark_failed(connection: AsyncConnection, slide_id: uuid.UUID, now: datetime) -> None:
    await connection.execute(
        update(slides)
        .where(slides.c.id == slide_id)
        .values(
            remote_failures=func.least(slides.c.remote_failures + 1, MAX_FAILURES),
            remote_failing_since=func.coalesce(slides.c.remote_failing_since, now),
        )
    )


async def expired_caches(connection: AsyncConnection, now: datetime) -> list[Any]:
    return list(
        await connection.execute(
            select(slides.c.id, slides.c.tenant_id).where(
                slides.c.storage == SlideStorage.REMOTE,
                slides.c.remote_read_at < now - timedelta(days=CACHE_DAYS),
            )
        )
    )


async def sweep_remote_cache(store: ObjectStore, connection: AsyncConnection, now: datetime) -> int:
    removed = 0
    for row in await expired_caches(connection, now):
        for key in await store.list_keys(cache_prefix(row.tenant_id, row.id)):
            await store.delete_object(key)
            removed += 1
        await connection.execute(
            update(slides).where(slides.c.id == row.id).values(remote_read_at=None)
        )
    return removed


async def probed_offline(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    row: Any,
    slide_id: uuid.UUID,
    policy: LinkPolicy,
    seconds: float,
) -> bool:
    now = datetime.now(UTC)
    try:
        remote = await source_reach(
            connection, keyring, row.tenant_id, row.source_id, row.remote_path, now
        )
        found = await probe(remote, policy, seconds)
    except LinkRefusedError, TimeoutError:
        await mark_failed(connection, slide_id, now)
        return row.source_id is None or row.remote_failures + 1 >= OFFLINE_AFTER_FAILURES
    if not same_file(Pinned(row.file_bytes, row.remote_etag), found):
        raise RemoteSlideChangedError
    await mark_reached(connection, slide_id, now)
    return False
