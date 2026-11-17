import asyncio
import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.remote_reads import probed_offline, served_name
from parfocal_api.restricted_images import sees_restricted
from parfocal_api.source_outages import notice_if_down
from parfocal_api.tables import PrivacyMode, SlideStorage, projects, slides
from parfocal_api.token_keys import decoded_key, usable_keys
from parfocal_api.uploads import Settings
from parfocal_common.ingest import RESTRICTED_RANGES_NAME, folder_of, slide_prefix
from parfocal_common.link_fetch import policy_of
from parfocal_common.object_store import ObjectStore, StorageError

TOKEN_VERSION = 1
TOKEN_SECONDS = 10 * 60
REFRESH_GRACE_SECONDS = 60

type ByteRange = tuple[int, int]


class TileAccessNotConfiguredError(ProblemError):
    status = 503
    code = "tile-access-not-configured"
    title = "Slide files cannot be served yet"


class SlideFileNotFoundError(NotFoundError):
    code = "slide-file-not-found"
    title = "This slide has no stored file"


class TileAccess(BaseModel):
    token: str
    expires_at: datetime
    lifetime_seconds: int
    base_path: str
    original: str
    format: str | None
    storage: Literal["uploaded", "remote"] = "uploaded"
    offline: bool = False


router = APIRouter(prefix="/api/slides/{slide_id}/tile-access", tags=["slides"])


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def key_of(secret: str) -> bytes:
    return decoded_key(secret)


def sign_capability(secret: str, claims: dict[str, Any]) -> str:
    payload = base64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(key_of(secret), payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{base64url(signature)}"


def unbase64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verified_claims(secret: str, token: str) -> dict[str, Any] | None:
    payload, _, signature = token.partition(".")
    expected = hmac.new(key_of(secret), payload.encode(), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(unbase64url(signature), expected):
            return None
        claims: object = json.loads(unbase64url(payload))
    except ValueError:
        return None
    if not isinstance(claims, dict):
        return None
    return {str(name): value for name, value in cast("dict[object, Any]", claims).items()}


def viewer_of(actor: Actor) -> str:
    identity = f"{actor.kind}:{actor.subject or actor.service_id}"
    return base64url(hashlib.sha256(identity.encode()).digest()[:12])


def claims_under_any(keys: list[str], token: str) -> dict[str, Any] | None:
    for secret in keys:
        claims = verified_claims(secret, token)
        if claims is not None:
            return claims
    return None


def continues_an_open(
    keys: list[str], previous: str | None, expected: dict[str, Any], now: int
) -> bool:
    if previous is None:
        return False
    claims = claims_under_any(keys, previous)
    if claims is None or not isinstance(claims.get("e"), int):
        return False
    same = all(claims.get(name) == value for name, value in expected.items())
    return same and claims["e"] + REFRESH_GRACE_SECONDS >= now


@dataclass(frozen=True)
class SlideRanges:
    closed: list[ByteRange]
    identifying: list[ByteRange] | None
    barcode: list[ByteRange] | None

    def served(
        self, file_bytes: int, identifying: bool, barcode: bool
    ) -> tuple[list[ByteRange], list[ByteRange]]:
        wanted = [
            spans
            for spans, needed in ((self.identifying, identifying), (self.barcode, barcode))
            if needed
        ]
        if any(spans is None for spans in wanted):
            return [(0, file_bytes)], []
        return self.closed, sorted(span for spans in wanted for span in spans or [])


def spans_of(value: Any) -> list[ByteRange]:
    return [(int(start), int(end)) for start, end in value]


def parsed_ranges(body: bytes) -> SlideRanges:
    document = json.loads(body)
    return SlideRanges(
        spans_of(document["ranges"]),
        spans_of(document["identifying"]) if "identifying" in document else None,
        spans_of(document["barcode"]) if "barcode" in document else None,
    )


async def restricted_ranges(store: ObjectStore, folder: str, file_bytes: int) -> SlideRanges:
    try:
        return parsed_ranges(await store.get_object(f"{folder}{RESTRICTED_RANGES_NAME}"))
    except StorageError as error:
        if error.status == 404:
            return SlideRanges([(0, file_bytes)], [], [])
        raise


@router.get("", operation_id="getTileAccess", **require(Permission.SEE_SLIDES))
async def get_tile_access(
    slide_id: uuid.UUID,
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
    settings: Settings,
    previous_tile_token: Annotated[str | None, Header()] = None,
) -> TileAccess:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id,
                slides.c.project_id,
                slides.c.original_key,
                slides.c.file_bytes,
                slides.c.format,
                slides.c.storage,
                slides.c.source_id,
                slides.c.remote_path,
                slides.c.remote_etag,
                slides.c.remote_failures,
                projects.c.privacy_mode,
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    mode = PrivacyMode(row.privacy_mode)
    await require_slide_reading(
        connection, principal, row.project_id, mode, slide_id, "Slide not found"
    )
    remote = row.storage == SlideStorage.REMOTE
    original_key: str | None = row.original_key
    if row.file_bytes is None or (original_key is None and not remote):
        raise SlideFileNotFoundError
    keys = usable_keys(settings.tile_token_key)
    if keys is None:
        raise TileAccessNotConfiguredError
    response.headers["Cache-Control"] = "private, no-store"
    actor = actor_of(principal)
    now = int(datetime.now(UTC).timestamp())
    viewer = {
        "v": TOKEN_VERSION,
        "t": str(row.tenant_id),
        "s": str(slide_id),
        "a": viewer_of(actor),
    }
    if not continues_an_open(keys, previous_tile_token, viewer, now):
        await record(
            connection,
            actor,
            AuditAction.SLIDE_OPENED,
            AuditTarget.SLIDE,
            slide_id,
            tenant_id=row.tenant_id,
        )
    offline = False
    if remote:
        offline = await probed_offline(
            connection,
            keyring_of(request),
            row,
            slide_id,
            policy_of(settings.link_trusted_origins),
            settings.link_read_seconds,
        )
        if offline:
            await notice_if_down(connection, slide_id, datetime.now(UTC))
        folder = slide_prefix(row.tenant_id, slide_id)
        original = served_name(row.remote_path)
        etag = row.remote_etag
        ranges = await restricted_ranges(store, folder, row.file_bytes)
    elif original_key is None:
        raise SlideFileNotFoundError
    else:
        folder = folder_of(original_key)
        original = PurePosixPath(original_key).name
        ranges, stored = await asyncio.gather(
            restricted_ranges(store, folder, row.file_bytes), store.stat_object(original_key)
        )
        etag = stored.etag if stored is not None and stored.etag else None
    labels = await sees_restricted(connection, principal, row.project_id, mode)
    closed, blank = ranges.served(row.file_bytes, mode is not PrivacyMode.CLINICAL, not labels)
    expires = now + TOKEN_SECONDS
    claims = {
        **viewer,
        "o": original,
        "n": row.file_bytes,
        "d": [list(span) for span in closed],
        "e": expires,
    }
    if blank:
        claims["b"] = [list(span) for span in blank]
    if etag:
        claims["g"] = etag
    if remote:
        claims["r"] = 1
    elif folder != slide_prefix(row.tenant_id, slide_id):
        claims["p"] = folder
    return TileAccess(
        token=sign_capability(keys[0], claims),
        expires_at=datetime.fromtimestamp(expires, UTC),
        lifetime_seconds=TOKEN_SECONDS,
        base_path=f"/api/remote-tiles/{slide_id}/" if remote else f"/tiles/{slide_id}/",
        original=original,
        format=row.format,
        storage=SlideStorage(row.storage).value,
        offline=offline,
    )
