import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Any, Self
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import insert, literal_column, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection, UserConnection
from parfocal_api.email_templates import DIGEST_TEMPLATE, render
from parfocal_api.notification_catalogue import DEFAULTS, Channels, TargetKind
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ForbiddenError
from parfocal_api.tables import (
    EmailDigest,
    EmailStatus,
    MuteSubject,
    NotificationKind,
    jobs,
    notification_mutes,
    notification_preferences,
    notifications,
    projects,
    review_tasks,
    slides,
    tenants,
    users,
)
from parfocal_api.users import signed_in
from parfocal_common.clients import EmailMessage, EmailSender
from parfocal_common.db import CURRENT_TENANT, DatabaseScope, scoped_transaction

DIGEST_WINDOWS = {EmailDigest.HOURLY: timedelta(hours=1), EmailDigest.DAILY: timedelta(days=1)}
MANDATORY = frozenset({NotificationKind.EMERGENCY_ACCESS})
GETS_THROUGH_MUTES = MANDATORY | {NotificationKind.MENTION}


@dataclass(frozen=True)
class Context:
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    case_id: uuid.UUID | None = None

    def subjects(self) -> list[tuple[MuteSubject, uuid.UUID]]:
        pairs = [
            (MuteSubject.PROJECT, self.project_id),
            (MuteSubject.TASK, self.task_id),
            (MuteSubject.CASE, self.case_id),
        ]
        return [(subject, value) for subject, value in pairs if value is not None]


class Preference(BaseModel):
    kind: NotificationKind
    in_app: bool
    email: bool
    realtime: bool
    mandatory: bool


class PreferenceChange(BaseModel):
    kind: NotificationKind
    in_app: bool
    email: bool
    realtime: bool


class PreferenceChanges(BaseModel):
    preferences: Annotated[list[PreferenceChange], Field(min_length=1, max_length=20)]


class MandatoryKindError(BadRequestError):
    code = "mandatory-notification"
    title = "This notification cannot be turned off"


class MembersOnlyError(ForbiddenError):
    code = "members-only"
    title = "Only members of this workspace have notifications"


router = APIRouter(prefix="/api/me/notification-preferences", tags=["me"])

IN_THIS_TENANT = notification_preferences.c.tenant_id == literal_column(CURRENT_TENANT)


async def channels_for(
    connection: AsyncConnection, recipients: Iterable[uuid.UUID], kind: NotificationKind
) -> dict[uuid.UUID, Channels]:
    people = list(dict.fromkeys(recipients))
    chosen = {
        row.user_id: Channels(in_app=row.in_app, email=row.email, realtime=row.realtime)
        for row in await connection.execute(
            select(notification_preferences).where(
                IN_THIS_TENANT,
                notification_preferences.c.kind == kind,
                notification_preferences.c.user_id.in_(people),
            )
        )
    }
    default = DEFAULTS[kind]
    return {
        person: default if kind in MANDATORY else chosen.get(person, default) for person in people
    }


def uuid_or_none(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def context_of(
    connection: AsyncConnection,
    target_type: str,
    target_id: uuid.UUID,
    payload: Mapping[str, Any],
) -> Context:
    match target_type:
        case TargetKind.TASK | TargetKind.EVALUATION:
            project_id = await connection.scalar(
                select(review_tasks.c.project_id).where(review_tasks.c.id == target_id)
            )
            return Context(project_id, target_id) if project_id else Context()
        case TargetKind.SLIDE:
            row = (
                await connection.execute(
                    select(slides.c.project_id, slides.c.case_id).where(slides.c.id == target_id)
                )
            ).one_or_none()
            if row is None:
                return Context()
            return Context(row.project_id, uuid_or_none(payload.get("task_id")), row.case_id)
        case TargetKind.JOB:
            return Context(
                await connection.scalar(select(jobs.c.project_id).where(jobs.c.id == target_id))
            )
        case TargetKind.PROJECT:
            return Context(
                await connection.scalar(select(projects.c.id).where(projects.c.id == target_id))
            )
        case _:
            return Context()


async def muted(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    people: list[uuid.UUID],
    kind: NotificationKind,
    context: Context,
) -> set[uuid.UUID]:
    subjects = context.subjects()
    if kind in GETS_THROUGH_MUTES or not subjects or not people:
        return set()
    found = await connection.scalars(
        select(notification_mutes.c.user_id).where(
            notification_mutes.c.tenant_id == tenant_id,
            notification_mutes.c.user_id.in_(people),
            tuple_(notification_mutes.c.subject, notification_mutes.c.subject_id).in_(subjects),
        )
    )
    return set(found)


async def notify(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    recipients: Iterable[uuid.UUID],
    kind: NotificationKind,
    target_type: str,
    target_id: uuid.UUID,
    payload: Mapping[str, Any] | None = None,
) -> int:
    details = dict(payload or {})
    context = await context_of(connection, target_type, target_id, details)
    people = list(dict.fromkeys(recipients))
    silenced = await muted(connection, tenant_id, people, kind, context)
    routed = await channels_for(connection, [p for p in people if p not in silenced], kind)
    rows = [
        {
            "tenant_id": tenant_id,
            "user_id": person,
            "kind": kind,
            "target_type": target_type,
            "target_id": target_id,
            "payload": details,
            "in_app": channels.in_app,
            "realtime": channels.realtime,
            "email_status": EmailStatus.PENDING if channels.email else EmailStatus.NONE,
            "project_id": context.project_id,
            "task_id": context.task_id,
            "case_id": context.case_id,
        }
        for person, channels in routed.items()
        if channels.in_app or channels.email or channels.realtime
    ]
    if rows:
        await connection.execute(insert(notifications), rows)
    return len(rows)


def link_to(origin: str, notification_id: uuid.UUID) -> str:
    return f"{origin}/go/{notification_id}"


def link_to_inbox(origin: str) -> str:
    return f"{origin}/inbox"


def in_quiet_hours(moment: datetime, row: Any) -> bool:
    if row.quiet_from is None or row.quiet_until is None or row.quiet_from == row.quiet_until:
        return False
    local = moment.astimezone(ZoneInfo(row.time_zone)).time()
    if row.quiet_from < row.quiet_until:
        return row.quiet_from <= local < row.quiet_until
    return local >= row.quiet_from or local < row.quiet_until


def due(moment: datetime, row: Any, waiting: list[Any]) -> bool:
    window = DIGEST_WINDOWS.get(EmailDigest(row.email_digest))
    if window is None:
        return True
    return waiting[0].created_at <= moment - window


def message(template: str, row: Any, link: str) -> EmailMessage:
    rendered = render(
        template,
        {"recipient_name": row.display_name, "workspace_name": row.workspace_name, "link": link},
    )
    return EmailMessage(
        to=row.email,
        template=template,
        link=link,
        subject=rendered.subject,
        text=rendered.text,
        html=rendered.html,
    )


async def deliver_pending_emails(
    connection: AsyncConnection,
    sender: EmailSender,
    origin: str,
    now: datetime | None = None,
) -> int:
    moment = now or datetime.now(UTC)
    pending = (
        await connection.execute(
            select(
                notifications.c.id,
                notifications.c.user_id,
                notifications.c.kind,
                notifications.c.created_at,
                users.c.email,
                users.c.display_name,
                users.c.email_digest,
                users.c.quiet_from,
                users.c.quiet_until,
                users.c.time_zone,
                tenants.c.name.label("workspace_name"),
            )
            .join(users, users.c.id == notifications.c.user_id)
            .join(tenants, tenants.c.id == notifications.c.tenant_id)
            .where(
                notifications.c.tenant_id == literal_column(CURRENT_TENANT),
                notifications.c.email_status == EmailStatus.PENDING,
            )
            .order_by(notifications.c.created_at)
            .with_for_update(of=notifications, skip_locked=True)
        )
    ).all()
    people: dict[uuid.UUID, list[Any]] = {}
    for row in pending:
        people.setdefault(row.user_id, []).append(row)
    sent = 0
    skipped: list[uuid.UUID] = []
    delivered: list[uuid.UUID] = []
    for rows in people.values():
        first = rows[0]
        if not first.email:
            skipped.extend(row.id for row in rows)
            continue
        for row in rows:
            if NotificationKind(row.kind) in MANDATORY:
                sender.send(message(f"notification.{row.kind}", row, link_to(origin, row.id)))
                delivered.append(row.id)
                sent += 1
        waiting = [row for row in rows if NotificationKind(row.kind) not in MANDATORY]
        if not waiting or in_quiet_hours(moment, first) or not due(moment, first, waiting):
            continue
        if len(waiting) == 1:
            only = waiting[0]
            sender.send(message(f"notification.{only.kind}", only, link_to(origin, only.id)))
        else:
            sender.send(message(DIGEST_TEMPLATE, first, link_to_inbox(origin)))
        delivered.extend(row.id for row in waiting)
        sent += 1
    if skipped:
        await connection.execute(
            update(notifications)
            .where(notifications.c.id.in_(skipped))
            .values(email_status=EmailStatus.SKIPPED)
        )
    if delivered:
        await connection.execute(
            update(notifications)
            .where(notifications.c.id.in_(delivered))
            .values(email_status=EmailStatus.SENT, emailed_at=moment)
        )
    return sent


async def deliver_after_commit(app: Any, tenant_id: uuid.UUID) -> None:
    async with scoped_transaction(
        app.state.engine, DatabaseScope(tenant_id=tenant_id)
    ) as connection:
        await deliver_pending_emails(connection, app.clients.email, app.state.auth.public_origin)


def member_of(principal: Principal) -> MemberPrincipal:
    if not isinstance(principal, MemberPrincipal):
        raise MembersOnlyError
    return principal


async def preferences_of(connection: AsyncConnection, user_id: uuid.UUID) -> list[Preference]:
    routed = {
        kind: (await channels_for(connection, [user_id], kind))[user_id]
        for kind in NotificationKind
    }
    return [
        Preference(
            kind=kind,
            in_app=channels.in_app,
            email=channels.email,
            realtime=channels.realtime,
            mandatory=kind in MANDATORY,
        )
        for kind, channels in routed.items()
    ]


@router.get("", operation_id="listNotificationPreferences")
async def list_notification_preferences(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[Preference]:
    return await preferences_of(connection, member_of(principal).user_id)


@router.put("", operation_id="setNotificationPreferences")
async def set_notification_preferences(
    changes: PreferenceChanges, principal: CurrentPrincipal, connection: TenantConnection
) -> list[Preference]:
    member = member_of(principal)
    if any(change.kind in MANDATORY for change in changes.preferences):
        raise MandatoryKindError
    for change in changes.preferences:
        values = {"in_app": change.in_app, "email": change.email, "realtime": change.realtime}
        await connection.execute(
            upsert(notification_preferences)
            .values(tenant_id=member.tenant_id, user_id=member.user_id, kind=change.kind, **values)
            .on_conflict_do_update(
                index_elements=[
                    notification_preferences.c.tenant_id,
                    notification_preferences.c.user_id,
                    notification_preferences.c.kind,
                ],
                set_=values,
            )
        )
    return await preferences_of(connection, member.user_id)


class EmailSchedule(BaseModel):
    digest: EmailDigest = EmailDigest.OFF
    quiet_from: time | None = None
    quiet_until: time | None = None
    time_zone: Annotated[str, Field(min_length=1, max_length=60)] = "UTC"

    @model_validator(mode="after")
    def check(self) -> Self:
        if (self.quiet_from is None) != (self.quiet_until is None):
            raise ValueError("Quiet hours need both a start and an end")
        if self.time_zone not in available_timezones():
            raise ValueError(f"Unknown time zone {self.time_zone}")
        return self


schedule_router = APIRouter(prefix="/api/me/email-schedule", tags=["me"])
SCHEDULE_COLUMNS = (
    users.c.email_digest,
    users.c.quiet_from,
    users.c.quiet_until,
    users.c.time_zone,
)


def schedule_of(row: Any) -> EmailSchedule:
    return EmailSchedule(
        digest=EmailDigest(row.email_digest),
        quiet_from=row.quiet_from,
        quiet_until=row.quiet_until,
        time_zone=row.time_zone,
    )


@schedule_router.get("", operation_id="getMyEmailSchedule")
async def get_my_email_schedule(
    principal: CurrentPrincipal, connection: UserConnection
) -> EmailSchedule:
    person = signed_in(principal)
    row = (
        await connection.execute(select(*SCHEDULE_COLUMNS).where(users.c.id == person.user_id))
    ).one()
    return schedule_of(row)


@schedule_router.put("", operation_id="setMyEmailSchedule")
async def set_my_email_schedule(
    schedule: EmailSchedule, principal: CurrentPrincipal, connection: UserConnection
) -> EmailSchedule:
    person = signed_in(principal)
    row = (
        await connection.execute(
            update(users)
            .where(users.c.id == person.user_id)
            .values(
                email_digest=schedule.digest,
                quiet_from=schedule.quiet_from,
                quiet_until=schedule.quiet_until,
                time_zone=schedule.time_zone,
            )
            .returning(*SCHEDULE_COLUMNS)
        )
    ).one()
    return schedule_of(row)
