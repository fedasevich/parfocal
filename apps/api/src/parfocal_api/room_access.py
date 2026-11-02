import time
import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import cast

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ForbiddenError, NotFoundError, ProblemError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import PrivacyMode, projects, slides
from parfocal_api.tile_access import sign_capability
from parfocal_api.uploads import Settings

ROOM_TOKEN_VERSION = 1
ROOM_TOKEN_SECONDS = 5 * 60
ROOM_PROTOCOL = "parfocal-room-v1"


class RoomKind(StrEnum):
    SLIDE = "slide"
    TASK = "task"
    USER = "user"


def room_name(kind: RoomKind, room_id: uuid.UUID) -> str:
    return f"{kind}:{room_id}"


class RealtimeNotConfiguredError(ProblemError):
    status = 503
    code = "realtime-not-configured"
    title = "Live updates are not available yet"


class RoomAccess(BaseModel):
    token: str
    expires_at: datetime
    lifetime_seconds: int
    path: str
    protocol: str


router = APIRouter(prefix="/api/rooms/{room}/access", tags=["realtime"])


def parsed_room(room: str) -> tuple[RoomKind, uuid.UUID]:
    kind, _, room_id = room.partition(":")
    try:
        return RoomKind(kind), uuid.UUID(room_id)
    except ValueError as error:
        raise NotFoundError("Room not found") from error


async def slide_project(
    connection: TenantConnection, principal: MemberPrincipal, slide_id: uuid.UUID
) -> uuid.UUID:
    row = (
        await connection.execute(
            select(slides.c.project_id, projects.c.privacy_mode)
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Room not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Room not found",
    )
    return cast("uuid.UUID", row.project_id)


async def room_project(
    connection: TenantConnection, principal: MemberPrincipal, kind: RoomKind, room_id: uuid.UUID
) -> uuid.UUID | None:
    if kind is RoomKind.USER:
        if room_id != principal.user_id:
            raise NotFoundError("Room not found")
        return None
    if kind is RoomKind.SLIDE:
        return await slide_project(connection, principal, room_id)
    task, _ = await readable_task(connection, principal, room_id)
    return cast("uuid.UUID", task.project_id)


@router.get("", operation_id="getRoomAccess")
async def get_room_access(
    room: str,
    response: Response,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> RoomAccess:
    if not isinstance(principal, MemberPrincipal):
        raise ForbiddenError
    kind, room_id = parsed_room(room)
    project_id = await room_project(connection, principal, kind, room_id)
    if settings.room_token_key is None or not settings.room_token_key.get_secret_value():
        raise RealtimeNotConfiguredError
    response.headers["Cache-Control"] = "private, no-store"
    expires = int(time.time()) + ROOM_TOKEN_SECONDS
    name = room_name(kind, room_id)
    claims = {
        "v": ROOM_TOKEN_VERSION,
        "t": str(principal.tenant_id),
        "r": name,
        "u": str(principal.user_id),
        "p": None if project_id is None else str(project_id),
        "e": expires,
    }
    return RoomAccess(
        token=sign_capability(settings.room_token_key.get_secret_value(), claims),
        expires_at=datetime.fromtimestamp(expires, UTC),
        lifetime_seconds=ROOM_TOKEN_SECONDS,
        path=f"/rt/{name}",
        protocol=ROOM_PROTOCOL,
    )
