import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import ColumnElement, delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.my_work import MAX_PAGE, PAGE, decode_cursor, encode_cursor
from parfocal_api.notification_catalogue import BREAKS_MUTES, CATALOGUE, TargetKind
from parfocal_api.notifications import link_to, member_of
from parfocal_api.permissions import Grant, Permission
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.project_access import assigned_slides, project_grant, reads_whole
from parfocal_api.projects import visible
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    EmailStatus,
    MuteSubject,
    NotificationKind,
    cases,
    notification_mutes,
    notifications,
    slides,
)

MAX_IDS = 200


class InboxItem(BaseModel):
    id: uuid.UUID
    kind: NotificationKind
    link: str
    target_kind: TargetKind
    target_id: uuid.UUID
    payload: dict[str, Any]
    project_id: uuid.UUID | None
    task_id: uuid.UUID | None
    case_id: uuid.UUID | None
    muted: bool
    read: bool
    read_at: datetime | None
    created_at: datetime


class InboxPage(BaseModel):
    notifications: list[InboxItem]
    next_cursor: str | None


class KindCount(BaseModel):
    kind: NotificationKind
    total: int
    unread: int


class InboxCounts(BaseModel):
    total: int
    unread: int
    kinds: list[KindCount]
    muted: int
    muted_unread: int


class MarkRead(BaseModel):
    ids: Annotated[list[uuid.UUID], Field(max_length=MAX_IDS)] = []
    all: bool = False
    kinds: Annotated[list[NotificationKind], Field(max_length=20)] = []
    up_to: datetime | None = None

    @model_validator(mode="after")
    def check(self) -> Self:
        if self.all == bool(self.ids):
            raise ValueError("Send either ids or all, not both")
        if (self.kinds or self.up_to) and not self.all:
            raise ValueError("Kinds and up_to only narrow all")
        return self


class Marked(BaseModel):
    marked: int
    unread: int


class Mute(BaseModel):
    subject: MuteSubject
    subject_id: uuid.UUID
    created_at: datetime


class MuteSubjectNotFoundError(NotFoundError):
    code = "mute-subject-not-found"
    title = "There is no such project, task or case for you to mute"


router = APIRouter(prefix="/api/me", tags=["me"])


def mine(me: MemberPrincipal) -> ColumnElement[bool]:
    return (notifications.c.user_id == me.user_id) & notifications.c.in_app


def item_of(row: Any) -> InboxItem:
    kind = NotificationKind(row.kind)
    return InboxItem(
        id=row.id,
        kind=kind,
        link=link_to("", row.id),
        target_kind=CATALOGUE[kind].target,
        target_id=row.target_id,
        payload=dict(row.payload),
        project_id=row.project_id,
        task_id=row.task_id,
        case_id=row.case_id,
        muted=row.muted,
        read=row.read_at is not None,
        read_at=row.read_at,
        created_at=row.created_at,
    )


@router.get("/notifications", operation_id="listNotifications")
async def list_notifications(
    principal: CurrentPrincipal,
    connection: TenantConnection,
    kind: Annotated[list[NotificationKind] | None, Query(max_length=20)] = None,
    read: bool | None = None,
    muted: bool = False,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = PAGE,
) -> InboxPage:
    me = member_of(principal)
    statement = (
        select(notifications)
        .where(mine(me), notifications.c.muted.is_(muted))
        .order_by(notifications.c.created_at.desc(), notifications.c.id.desc())
        .limit(limit + 1)
    )
    if kind:
        statement = statement.where(notifications.c.kind.in_(kind))
    if read is not None:
        statement = statement.where(
            notifications.c.read_at.is_not(None) if read else notifications.c.read_at.is_(None)
        )
    if cursor:
        statement = statement.where(
            tuple_(notifications.c.created_at, notifications.c.id) < tuple_(*decode_cursor(cursor))
        )
    rows = (await connection.execute(statement)).all()
    page = [item_of(row) for row in rows[:limit]]
    more = len(rows) > limit
    return InboxPage(
        notifications=page,
        next_cursor=encode_cursor(page[-1].created_at, page[-1].id) if more else None,
    )


async def counts_of(connection: AsyncConnection, me: MemberPrincipal) -> InboxCounts:
    rows = (
        await connection.execute(
            select(
                notifications.c.kind,
                notifications.c.muted,
                func.count().label("total"),
                func.count().filter(notifications.c.read_at.is_(None)).label("unread"),
            )
            .where(mine(me))
            .group_by(notifications.c.kind, notifications.c.muted)
        )
    ).all()
    found = {row.kind: row for row in rows if not row.muted}
    silenced = [row for row in rows if row.muted]
    kinds = [
        KindCount(
            kind=kind,
            total=found[kind].total if kind in found else 0,
            unread=found[kind].unread if kind in found else 0,
        )
        for kind in CATALOGUE
    ]
    return InboxCounts(
        total=sum(item.total for item in kinds),
        unread=sum(item.unread for item in kinds),
        kinds=kinds,
        muted=sum(row.total for row in silenced),
        muted_unread=sum(row.unread for row in silenced),
    )


@router.get("/notifications/counts", operation_id="getNotificationCounts")
async def get_notification_counts(
    principal: CurrentPrincipal, connection: TenantConnection
) -> InboxCounts:
    return await counts_of(connection, member_of(principal))


@router.post("/notifications/read", operation_id="markNotificationsRead")
async def mark_notifications_read(
    request: MarkRead, principal: CurrentPrincipal, connection: TenantConnection
) -> Marked:
    me = member_of(principal)
    statement = update(notifications).where(mine(me), notifications.c.read_at.is_(None))
    if request.ids:
        statement = statement.where(notifications.c.id.in_(request.ids))
    if request.kinds:
        statement = statement.where(notifications.c.kind.in_(request.kinds))
    if request.up_to is not None:
        statement = statement.where(notifications.c.created_at <= request.up_to)
    marked = await connection.execute(
        statement.values(read_at=func.now()).returning(notifications.c.id)
    )
    count = len(marked.all())
    return Marked(marked=count, unread=(await counts_of(connection, me)).unread)


async def check_subject(
    connection: AsyncConnection,
    me: MemberPrincipal,
    subject: MuteSubject,
    subject_id: uuid.UUID,
) -> None:
    try:
        match subject:
            case MuteSubject.PROJECT:
                await visible(connection, me, subject_id)
            case MuteSubject.TASK:
                await readable_task(connection, me, subject_id)
            case MuteSubject.CASE:
                await check_case(connection, me, subject_id)
    except (NotFoundError, ForbiddenError) as error:
        raise MuteSubjectNotFoundError from error


async def check_case(connection: AsyncConnection, me: MemberPrincipal, case_id: uuid.UUID) -> None:
    project_id = await connection.scalar(
        select(cases.c.project_id).where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
    )
    if project_id is None:
        raise MuteSubjectNotFoundError
    grant = await project_grant(connection, me, project_id, Permission.SEE_SLIDES)
    if reads_whole(grant):
        return
    task_slides = select(slides.c.id).where(
        slides.c.case_id == case_id,
        slides.c.deleted_at.is_(None),
        slides.c.id.in_(assigned_slides(me)),
    )
    if grant is not Grant.ASSIGNED or not await connection.scalar(select(task_slides.exists())):
        raise MuteSubjectNotFoundError


async def mutes_of(connection: AsyncConnection, me: MemberPrincipal) -> list[Mute]:
    rows = await connection.execute(
        select(notification_mutes)
        .where(notification_mutes.c.user_id == me.user_id)
        .order_by(notification_mutes.c.created_at, notification_mutes.c.subject_id)
    )
    return [
        Mute(subject=MuteSubject(row.subject), subject_id=row.subject_id, created_at=row.created_at)
        for row in rows
    ]


CONTEXT_COLUMNS = {
    MuteSubject.PROJECT: notifications.c.project_id,
    MuteSubject.TASK: notifications.c.task_id,
    MuteSubject.CASE: notifications.c.case_id,
}


@router.get("/notification-mutes", operation_id="listNotificationMutes")
async def list_notification_mutes(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[Mute]:
    return await mutes_of(connection, member_of(principal))


@router.put("/notification-mutes/{subject}/{subject_id}", operation_id="muteNotifications")
async def mute_notifications(
    subject: MuteSubject,
    subject_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[Mute]:
    me = member_of(principal)
    await check_subject(connection, me, subject, subject_id)
    await connection.execute(
        upsert(notification_mutes)
        .values(tenant_id=me.tenant_id, user_id=me.user_id, subject=subject, subject_id=subject_id)
        .on_conflict_do_nothing()
    )
    await connection.execute(
        update(notifications)
        .where(
            notifications.c.user_id == me.user_id,
            notifications.c.email_status == EmailStatus.PENDING,
            notifications.c.kind.not_in(BREAKS_MUTES),
            CONTEXT_COLUMNS[subject] == subject_id,
        )
        .values(email_status=EmailStatus.SKIPPED)
    )
    return await mutes_of(connection, me)


@router.delete("/notification-mutes/{subject}/{subject_id}", operation_id="unmuteNotifications")
async def unmute_notifications(
    subject: MuteSubject,
    subject_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[Mute]:
    me = member_of(principal)
    await connection.execute(
        delete(notification_mutes).where(
            notification_mutes.c.user_id == me.user_id,
            notification_mutes.c.subject == subject,
            notification_mutes.c.subject_id == subject_id,
        )
    )
    return await mutes_of(connection, me)
