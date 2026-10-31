import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, status
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.tables import AnnouncementKind, announcements

CURRENT_LIMIT = 20

AnnouncementText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=280)
]


class AnnouncementDraft(BaseModel):
    kind: AnnouncementKind
    text: AnnouncementText
    ends_at: datetime | None = None


class Announcement(BaseModel):
    id: uuid.UUID
    kind: AnnouncementKind
    text: str
    ends_at: datetime | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class EndsInThePastError(BadRequestError):
    code = "ends-in-the-past"
    title = "An announcement must end in the future"


class AnnouncementNotFoundError(NotFoundError):
    code = "announcement-not-found"
    title = "There is no such announcement"


router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def announcement_of(row: Any) -> Announcement:
    return Announcement(
        id=row.id,
        kind=AnnouncementKind(row.kind),
        text=row.text,
        ends_at=row.ends_at,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def is_current() -> Any:
    return or_(announcements.c.ends_at.is_(None), announcements.c.ends_at > func.now())


async def current_announcements(connection: AsyncConnection) -> list[Announcement]:
    rows = await connection.execute(
        select(announcements)
        .where(is_current())
        .order_by(announcements.c.created_at.desc(), announcements.c.id)
        .limit(CURRENT_LIMIT)
    )
    return [announcement_of(row) for row in rows]


@router.get("", operation_id="listAnnouncements")
async def list_announcements(connection: TenantConnection) -> list[Announcement]:
    return await current_announcements(connection)


@router.post(
    "",
    operation_id="createAnnouncement",
    status_code=status.HTTP_201_CREATED,
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def create_announcement(
    draft: AnnouncementDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> Announcement:
    if draft.ends_at is not None and draft.ends_at <= datetime.now(UTC):
        raise EndsInThePastError
    row = (
        await connection.execute(
            insert(announcements)
            .values(
                tenant_id=database_scope(principal).tenant_id,
                kind=draft.kind,
                text=draft.text,
                ends_at=draft.ends_at,
                created_by_user_id=user_of(principal),
            )
            .returning(announcements)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.ANNOUNCEMENT_POSTED,
        AuditTarget.ANNOUNCEMENT,
        row.id,
        tenant_id=row.tenant_id,
        details={"kind": draft.kind.value},
    )
    return announcement_of(row)


@router.post(
    "/{announcement_id}/end",
    operation_id="endAnnouncement",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def end_announcement(
    announcement_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Announcement:
    ended = (
        await connection.execute(
            update(announcements)
            .where(announcements.c.id == announcement_id, is_current())
            .values(ends_at=func.now())
            .returning(announcements)
        )
    ).one_or_none()
    if ended is not None:
        await record(
            connection,
            actor_of(principal),
            AuditAction.ANNOUNCEMENT_ENDED,
            AuditTarget.ANNOUNCEMENT,
            ended.id,
            tenant_id=ended.tenant_id,
        )
        return announcement_of(ended)
    found = (
        await connection.execute(select(announcements).where(announcements.c.id == announcement_id))
    ).one_or_none()
    if found is None:
        raise AnnouncementNotFoundError
    return announcement_of(found)
