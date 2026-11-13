import base64
import hashlib
import hmac
import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Annotated, Any, cast

from fastapi import APIRouter, Header, Response
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.tables import PrivacyMode, projects, slides
from parfocal_api.token_keys import decoded_key, usable_secret
from parfocal_api.uploads import Settings
from parfocal_common.ingest import RESTRICTED_RANGES_NAME, folder_of, slide_prefix
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


def continues_an_open(
    secret: str, previous: str | None, expected: dict[str, Any], now: int
) -> bool:
    if previous is None:
        return False
    claims = verified_claims(secret, previous)
    if claims is None or not isinstance(claims.get("e"), int):
        return False
    same = all(claims.get(name) == value for name, value in expected.items())
    return same and claims["e"] + REFRESH_GRACE_SECONDS >= now


def parsed_ranges(body: bytes) -> list[ByteRange]:
    ranges = json.loads(body)["ranges"]
    return [(int(start), int(end)) for start, end in ranges]


async def restricted_ranges(
    store: ObjectStore, folder: str, file_bytes: int
) -> Sequence[ByteRange]:
    try:
        return parsed_ranges(await store.get_object(f"{folder}{RESTRICTED_RANGES_NAME}"))
    except StorageError as error:
        if error.status == 404:
            return [(0, file_bytes)]
        raise


@router.get("", operation_id="getTileAccess", **require(Permission.SEE_SLIDES))
async def get_tile_access(
    slide_id: uuid.UUID,
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
                projects.c.privacy_mode,
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Slide not found",
    )
    if row.original_key is None or row.file_bytes is None:
        raise SlideFileNotFoundError
    secret = usable_secret(settings.tile_token_key)
    if secret is None:
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
    if not continues_an_open(secret, previous_tile_token, viewer, now):
        await record(
            connection,
            actor,
            AuditAction.SLIDE_OPENED,
            AuditTarget.SLIDE,
            slide_id,
            tenant_id=row.tenant_id,
        )
    folder = folder_of(row.original_key)
    ranges = await restricted_ranges(store, folder, row.file_bytes)
    expires = now + TOKEN_SECONDS
    original = PurePosixPath(row.original_key).name
    claims = {
        **viewer,
        "o": original,
        "n": row.file_bytes,
        "d": [list(span) for span in ranges],
        "e": expires,
    }
    if folder != slide_prefix(row.tenant_id, slide_id):
        claims["p"] = folder
    return TileAccess(
        token=sign_capability(secret, claims),
        expires_at=datetime.fromtimestamp(expires, UTC),
        lifetime_seconds=TOKEN_SECONDS,
        base_path=f"/tiles/{slide_id}/",
        original=original,
        format=row.format,
    )
