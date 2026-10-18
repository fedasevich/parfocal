import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ForbiddenError
from parfocal_api.tables import (
    EmailStatus,
    NotificationKind,
    notification_preferences,
    notifications,
    users,
)
from parfocal_common.clients import EmailMessage, EmailSender
from parfocal_common.db import CURRENT_TENANT, DatabaseScope, scoped_transaction


@dataclass(frozen=True)
class Channels:
    in_app: bool
    email: bool
    realtime: bool


class TargetKind(StrEnum):
    SLIDE = "slide"
    THREAD = "thread"
    TASK = "task"
    EVALUATION = "evaluation"
    JOB = "job"
    DELIVERY = "delivery"
    PROJECT = "project"


@dataclass(frozen=True)
class Entry:
    target: TargetKind
    subject: str
    line: str
    channels: Channels


ALL = Channels(in_app=True, email=True, realtime=True)
QUIET = Channels(in_app=True, email=False, realtime=True)

CATALOGUE: Mapping[NotificationKind, Entry] = {
    NotificationKind.MENTION: Entry(
        TargetKind.THREAD, "You were mentioned", "Someone mentioned you in a thread.", ALL
    ),
    NotificationKind.REPLY: Entry(
        TargetKind.THREAD, "New reply", "There is a new reply in a thread you follow.", QUIET
    ),
    NotificationKind.TASK_ASSIGNED: Entry(
        TargetKind.TASK, "New review task", "A review task was handed to you.", ALL
    ),
    NotificationKind.TASK_DUE_SOON: Entry(
        TargetKind.TASK, "Review task due soon", "A review task of yours is due soon.", ALL
    ),
    NotificationKind.MODEL_RUN_FINISHED: Entry(
        TargetKind.JOB, "Model run finished", "A model run you started has finished.", QUIET
    ),
    NotificationKind.MODEL_RUN_PAUSED: Entry(
        TargetKind.JOB, "Model run paused", "A model run you started is paused.", ALL
    ),
    NotificationKind.UPLOAD_DONE: Entry(
        TargetKind.JOB, "Upload done", "Your upload has been checked and is ready.", QUIET
    ),
    NotificationKind.DISAGREEMENTS_READY: Entry(
        TargetKind.TASK,
        "Disagreements to decide",
        "Every reviewer has submitted and some objects need your decision.",
        ALL,
    ),
    NotificationKind.TASK_SIGNED_OFF: Entry(
        TargetKind.EVALUATION, "Task signed off", "A review task was signed off.", ALL
    ),
    NotificationKind.RESULT_SET_ADDED: Entry(
        TargetKind.SLIDE, "Results added", "A pipeline added AI results to a slide.", QUIET
    ),
    NotificationKind.INTEGRATION_DOWN: Entry(
        TargetKind.DELIVERY,
        "Integration down",
        "Parfocal could not reach a connected service.",
        ALL,
    ),
    NotificationKind.EMERGENCY_ACCESS: Entry(
        TargetKind.PROJECT,
        "Emergency access to your project",
        "Someone opened your clinical project with emergency access.",
        ALL,
    ),
}
DEFAULTS: Mapping[NotificationKind, Channels] = {
    kind: entry.channels for kind, entry in CATALOGUE.items()
}
MANDATORY = frozenset({NotificationKind.EMERGENCY_ACCESS})


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


async def notify(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    recipients: Iterable[uuid.UUID],
    kind: NotificationKind,
    target_type: str,
    target_id: uuid.UUID,
    payload: Mapping[str, Any] | None = None,
) -> int:
    routed = await channels_for(connection, recipients, kind)
    rows = [
        {
            "tenant_id": tenant_id,
            "user_id": person,
            "kind": kind,
            "target_type": target_type,
            "target_id": target_id,
            "payload": dict(payload or {}),
            "in_app": channels.in_app,
            "realtime": channels.realtime,
            "email_status": EmailStatus.PENDING if channels.email else EmailStatus.NONE,
        }
        for person, channels in routed.items()
        if channels.in_app or channels.email or channels.realtime
    ]
    if rows:
        await connection.execute(insert(notifications), rows)
    return len(rows)


def link_to(origin: str, notification_id: uuid.UUID) -> str:
    return f"{origin}/go/{notification_id}"


async def deliver_pending_emails(
    connection: AsyncConnection, sender: EmailSender, origin: str
) -> int:
    pending = (
        await connection.execute(
            select(
                notifications.c.id,
                notifications.c.kind,
                notifications.c.target_type,
                notifications.c.target_id,
                users.c.email,
            )
            .join(users, users.c.id == notifications.c.user_id)
            .where(
                notifications.c.tenant_id == literal_column(CURRENT_TENANT),
                notifications.c.email_status == EmailStatus.PENDING,
            )
            .order_by(notifications.c.created_at)
            .with_for_update(of=notifications, skip_locked=True)
        )
    ).all()
    sent = 0
    for row in pending:
        if row.email:
            sender.send(
                EmailMessage(
                    to=row.email,
                    template=f"notification.{row.kind}",
                    link=link_to(origin, row.id),
                )
            )
            sent += 1
        await connection.execute(
            update(notifications)
            .where(notifications.c.id == row.id)
            .values(
                email_status=EmailStatus.SENT if row.email else EmailStatus.SKIPPED,
                emailed_at=func.now() if row.email else None,
            )
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
