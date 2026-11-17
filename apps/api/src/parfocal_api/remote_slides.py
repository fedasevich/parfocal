import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Annotated, Any

from fastapi import APIRouter, Header, Path, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection, engine_of, store_of
from parfocal_api.identifiers import load_keys
from parfocal_api.import_sources import credential_of, source_row
from parfocal_api.link_imports import look, planned_files, reach_for
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import (
    BadRequestError,
    NotFoundError,
    ProblemError,
    UnauthenticatedError,
)
from parfocal_api.remote_reads import (
    MAX_RANGE_BYTES,
    Pinned,
    Remote,
    RemoteSlideChangedError,
    cache_key,
    cache_tag,
    cached,
    fetch_range,
    mark_failed,
    mark_reached,
    mark_read,
    probe,
    remote_of,
    remote_path_of,
    same_file,
    source_reach,
)
from parfocal_api.slide_ingest import LABEL_ATTEMPTS, free_label, label_stem, taken_labels
from parfocal_api.tables import SlideStorage, slides
from parfocal_api.tile_access import claims_under_any
from parfocal_api.token_keys import usable_keys
from parfocal_api.uploads import Settings, settings_of
from parfocal_common.db import tenant_transaction
from parfocal_common.link_fetch import LinkRefusedError, policy_of
from parfocal_common.remote_inspect import enqueue_remote_inspect
from parfocal_common.result_imports import UploadKind

SINGLE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
BEARER = re.compile(r"^Bearer ([A-Za-z0-9_.-]+)$")
BASE_HEADERS = {
    "Cache-Control": "private, max-age=3600",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
}

type ProjectId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/projects", tags=["uploads"])
public_router = APIRouter(prefix="/api/remote-tiles", tags=["slides"])


class TileTokenError(UnauthenticatedError):
    code = "tile-token-invalid"
    title = "The capability token is not valid"


class TileTokenExpiredError(UnauthenticatedError):
    code = "tile-token-expired"
    title = "The capability token has expired"


class RangeNotServedError(ProblemError):
    status = 416
    code = "range-not-satisfiable"
    title = "Give one byte range of at most 16 MB inside the file"


class RangeRestrictedError(ProblemError):
    status = 403
    code = "range-restricted"
    title = "These bytes hold a label or macro image"


class SlideOfflineError(ProblemError):
    status = 503
    code = "slide-offline"
    title = "The source of this slide cannot be reached, and these tiles are not cached"


class NoSlidesChosenError(BadRequestError):
    code = "nothing-chosen"
    title = "None of the chosen files can be read in place"


class ReadInPlaceRequest(BaseModel):
    source_id: uuid.UUID
    names: Annotated[list[Annotated[str, StringConstraints(max_length=255)]], Field(min_length=1)]


class SlideInPlace(BaseModel):
    name: str
    slide_id: uuid.UUID
    job_id: uuid.UUID


class ReadInPlace(BaseModel):
    opened: list[SlideInPlace]
    left_out: list[str]


@dataclass(frozen=True)
class Grant:
    tenant_id: uuid.UUID
    pinned: Pinned
    restricted: list[tuple[int, int]]
    blank: list[tuple[int, int]]


def spans(value: Any) -> list[tuple[int, int]]:
    return [(int(start), int(end)) for start, end in value or []]


def grant_of(request: Request, slide_id: uuid.UUID, name: str, authorization: str | None) -> Grant:
    keys = usable_keys(settings_of(request).tile_token_key)
    found = BEARER.match(authorization or "")
    if keys is None or found is None:
        raise TileTokenError
    claims = claims_under_any(keys, found.group(1))
    if claims is None or claims.get("r") != 1 or claims.get("s") != str(slide_id):
        raise TileTokenError
    if claims.get("o") != name:
        raise TileTokenError
    if not isinstance(claims.get("e"), int) or claims["e"] < datetime.now(UTC).timestamp():
        raise TileTokenExpiredError
    return Grant(
        uuid.UUID(str(claims["t"])),
        Pinned(int(claims["n"]), claims.get("g")),
        spans(claims.get("d")),
        spans(claims.get("b")),
    )


def wanted(header: str | None, size: int) -> tuple[int, int]:
    found = SINGLE_RANGE.match((header or "").strip())
    if found is None or found.groups() == ("", ""):
        raise RangeNotServedError
    first, last = found.groups()
    if first == "":
        start, end = max(0, size - int(last)), size
    else:
        start = int(first)
        end = size if last == "" else min(size, int(last) + 1)
    if start >= end or end - start > MAX_RANGE_BYTES:
        raise RangeNotServedError
    return start, end


def overlaps(ranges: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(first < end and start < last for first, last in ranges)


def blanked(body: bytes, blank: list[tuple[int, int]], start: int) -> bytes:
    if not overlaps(blank, start, start + len(body)):
        return body
    out = bytearray(body)
    for first, last in blank:
        low, high = max(first, start) - start, min(last, start + len(body)) - start
        if low < high:
            out[low:high] = bytes(high - low)
    return bytes(out)


async def reach_of_slide(
    request: Request, tenant_id: uuid.UUID, slide_id: uuid.UUID, now: datetime
) -> Remote | None:
    async with tenant_transaction(engine_of(request), tenant_id) as connection:
        row = (
            await connection.execute(
                select(slides.c.source_id, slides.c.remote_path).where(
                    slides.c.id == slide_id,
                    slides.c.storage == SlideStorage.REMOTE,
                    slides.c.deleted_at.is_(None),
                )
            )
        ).first()
        if row is None:
            raise NotFoundError("Slide not found")
        try:
            return await source_reach(
                connection, keyring_of(request), tenant_id, row.source_id, row.remote_path, now
            )
        except LinkRefusedError:
            return None


async def read_through(
    request: Request, grant: Grant, slide_id: uuid.UUID, start: int, end: int
) -> bytes:
    store = store_of(request)
    settings = settings_of(request)
    key = cache_key(grant.tenant_id, slide_id, grant.pinned, start, end - start)
    now = datetime.now(UTC)
    body = await cached(store, key)
    if body is not None:
        async with tenant_transaction(engine_of(request), grant.tenant_id) as connection:
            await mark_read(connection, slide_id, now)
        return body
    remote = await reach_of_slide(request, grant.tenant_id, slide_id, now)
    found: Pinned | None = None
    if remote is not None:
        try:
            body, found = await fetch_range(
                remote,
                policy_of(settings.link_trusted_origins),
                settings.link_read_seconds,
                start,
                end - start,
            )
        except LinkRefusedError, TimeoutError:
            body = None
    async with tenant_transaction(engine_of(request), grant.tenant_id) as connection:
        if body is None:
            await mark_failed(connection, slide_id, now)
        else:
            await mark_reached(connection, slide_id, now)
    if body is None or found is None:
        raise SlideOfflineError
    if not same_file(grant.pinned, found):
        raise RemoteSlideChangedError
    await store.put_object(key, body, "application/octet-stream")
    return body


@public_router.get("/{slide_id}/{name}", operation_id="getRemoteTile")
async def get_remote_tile(
    slide_id: uuid.UUID,
    name: str,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    range_header: Annotated[str | None, Header(alias="range")] = None,
) -> Response:
    grant = grant_of(request, slide_id, name, authorization)
    start, end = wanted(range_header, grant.pinned.size)
    if overlaps(grant.restricted, start, end):
        raise RangeRestrictedError
    body = blanked(await read_through(request, grant, slide_id, start, end), grant.blank, start)
    tag = cache_tag(grant.pinned)
    headers = {
        **BASE_HEADERS,
        "Content-Range": f"bytes {start}-{end - 1}/{grant.pinned.size}",
        "ETag": f'"{tag}-blank"' if overlaps(grant.blank, start, end) else f'"{tag}"',
    }
    return Response(
        content=body, status_code=206, headers=headers, media_type="application/octet-stream"
    )


async def insert_remote_slide(
    connection: AsyncConnection,
    values: dict[str, Any],
    project_id: uuid.UUID,
    case_id: uuid.UUID | None,
    file_name: str,
) -> bool:
    stem = await label_stem(connection, SimpleNamespace(project_id=project_id, file_name=file_name))
    for _ in range(LABEL_ATTEMPTS):
        label = free_label(stem, await taken_labels(connection, project_id, case_id, stem))
        try:
            async with connection.begin_nested():
                await connection.execute(insert(slides).values(label=label, **values))
            return True
        except IntegrityError:
            continue
    return False


@router.post(
    "/{project_id}/remote-slides",
    operation_id="readInPlace",
    status_code=202,
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def read_in_place(
    project_id: ProjectId,
    body: ReadInPlaceRequest,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> ReadInPlace:
    reach = await reach_for(request, connection, principal, settings, None, body.source_id)
    found = await look(connection, principal, settings, project_id, reach)
    chosen = [
        item
        for item in planned_files(found, settings, set(body.names))
        if item.kind is UploadKind.SLIDE
    ]
    if not chosen:
        raise NoSlidesChosenError
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    source = await source_row(connection, body.source_id)
    credential = None
    if source.credential_ciphertext is not None:
        credential = credential_of(
            await load_keys(connection, keyring_of(request), tenant_id), source
        )
    policy = policy_of(settings.link_trusted_origins)
    opened: list[SlideInPlace] = []
    now = datetime.now(UTC)
    for item in chosen:
        path = remote_path_of(source, item.file.url)
        if path is None:
            continue
        try:
            pinned = await probe(
                remote_of(source, credential, path, now), policy, settings.link_read_seconds
            )
        except LinkRefusedError, TimeoutError:
            continue
        slide_id = uuid.uuid4()
        values = {
            "id": slide_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "case_id": item.case_id,
            "storage": SlideStorage.REMOTE,
            "source_id": source.id,
            "remote_path": path,
            "remote_etag": pinned.etag,
            "file_bytes": pinned.size,
            "remote_read_at": now,
        }
        if not await insert_remote_slide(connection, values, project_id, item.case_id, path):
            continue
        job_id = await enqueue_remote_inspect(connection, tenant_id, project_id, slide_id)
        await record(
            connection,
            actor_of(principal),
            AuditAction.SLIDE_READ_IN_PLACE,
            AuditTarget.SLIDE,
            slide_id,
            tenant_id=tenant_id,
            details={"project_id": str(project_id), "source_id": str(source.id)},
        )
        opened.append(SlideInPlace(name=item.file.name, slide_id=slide_id, job_id=job_id))
    names = {entry.name for entry in opened}
    left_out = sorted(name for name in body.names if name not in names)
    return ReadInPlace(opened=opened, left_out=left_out)
