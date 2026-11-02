import base64
import hashlib
import hmac
import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.tables import PrivacyMode, projects, slides
from parfocal_api.uploads import Settings
from parfocal_common.ingest import restricted_ranges_key
from parfocal_common.object_store import ObjectStore, StorageError

TOKEN_VERSION = 1
TOKEN_SECONDS = 10 * 60

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


router = APIRouter(prefix="/api/slides/{slide_id}/tile-access", tags=["slides"])


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign_capability(secret: str, claims: dict[str, Any]) -> str:
    payload = base64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    key = base64.urlsafe_b64decode(secret.replace("+", "-").replace("/", "_"))
    signature = hmac.new(key, payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{base64url(signature)}"


def parsed_ranges(body: bytes) -> list[ByteRange]:
    ranges = json.loads(body)["ranges"]
    return [(int(start), int(end)) for start, end in ranges]


async def restricted_ranges(
    store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID, file_bytes: int
) -> Sequence[ByteRange]:
    try:
        return parsed_ranges(await store.get_object(restricted_ranges_key(tenant_id, slide_id)))
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
) -> TileAccess:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id,
                slides.c.project_id,
                slides.c.original_key,
                slides.c.file_bytes,
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
    if settings.tile_token_key is None:
        raise TileAccessNotConfiguredError
    response.headers["Cache-Control"] = "private, no-store"
    ranges = await restricted_ranges(store, row.tenant_id, slide_id, row.file_bytes)
    expires = int(datetime.now(UTC).timestamp()) + TOKEN_SECONDS
    original = PurePosixPath(row.original_key).name
    claims = {
        "v": TOKEN_VERSION,
        "t": str(row.tenant_id),
        "s": str(slide_id),
        "o": original,
        "n": row.file_bytes,
        "d": [list(span) for span in ranges],
        "e": expires,
    }
    return TileAccess(
        token=sign_capability(settings.tile_token_key.get_secret_value(), claims),
        expires_at=datetime.fromtimestamp(expires, UTC),
        lifetime_seconds=TOKEN_SECONDS,
        base_path=f"/tiles/{slide_id}/",
        original=original,
    )
