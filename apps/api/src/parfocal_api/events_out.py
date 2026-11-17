import secrets
import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

import httpx2
from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import ensure_keys, seal_field
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import (
    EventKind,
    EventStatus,
    event_attempts,
    event_outbox,
    event_targets,
    projects,
)
from parfocal_api.uploads import Settings
from parfocal_common.link_fetch import LINK_FAILURES, LinkRefusedError, policy_of, target_of

TABLE = "event_targets"
SECRET_FIELD = "secret"
LOG_SHOWN = 50

type Address = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)
]
type TargetId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/projects/{project_id}/event-targets", tags=["projects"])


class EventTargetInvalidError(BadRequestError):
    code = "event-target-invalid"
    title = "Events cannot be sent to this address"


class EventTargetNotFoundError(NotFoundError):
    code = "event-target-not-found"
    title = "This project has no such event target"


class EventNotFoundError(NotFoundError):
    code = "event-not-found"
    title = "This event target sent no such event"


class EventNotFailedError(ConflictError):
    code = "event-not-failed"
    title = "Only a failed event can be sent again"


class EventTargetDraft(BaseModel):
    address: Address
    events: list[EventKind] = Field(min_length=1)


class EventTarget(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    address: str
    host: str
    events: list[EventKind]
    failures_in_row: int
    paused_at: datetime | None
    created_at: datetime


class SavedEventTarget(EventTarget):
    secret: str


class EventTargets(BaseModel):
    targets: list[EventTarget]


class EventAttempt(BaseModel):
    outcome: str
    status_code: int | None
    duration_ms: int
    created_at: datetime


class EventDelivery(BaseModel):
    id: uuid.UUID
    kind: EventKind
    sequence: int
    status: EventStatus
    attempts: int
    next_attempt_at: datetime
    delivered_at: datetime | None
    created_at: datetime
    log: list[EventAttempt]


class EventDeliveries(BaseModel):
    events: list[EventDelivery]


def host_of(address: str) -> str:
    return httpx2.URL(address).netloc.decode("ascii")


async def check_address(settings: Settings, address: str) -> None:
    try:
        url = httpx2.URL(address)
    except httpx2.InvalidURL as error:
        raise EventTargetInvalidError("Give a full HTTPS address.") from error
    try:
        await target_of(url, policy_of(settings.link_trusted_origins))
    except LinkRefusedError as error:
        raise EventTargetInvalidError(LINK_FAILURES[error.code]) from error


def target_of_row(row: Row[Any]) -> EventTarget:
    return EventTarget(
        id=row.id,
        project_id=row.project_id,
        address=row.address,
        host=host_of(row.address),
        events=[EventKind(kind) for kind in row.events],
        failures_in_row=row.failures_in_row,
        paused_at=row.paused_at,
        created_at=row.created_at,
    )


async def live_project(connection: AsyncConnection, project_id: uuid.UUID) -> None:
    if not await connection.scalar(
        select(projects.c.id).where(projects.c.id == project_id, projects.c.deleted_at.is_(None))
    ):
        raise EventTargetNotFoundError


async def target_row(
    connection: AsyncConnection, project_id: uuid.UUID, target_id: uuid.UUID
) -> Row[Any]:
    row = (
        await connection.execute(
            select(event_targets).where(
                event_targets.c.id == target_id, event_targets.c.project_id == project_id
            )
        )
    ).one_or_none()
    if row is None:
        raise EventTargetNotFoundError
    return row


async def audited(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Row[Any],
    details: Mapping[str, Any] | None = None,
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.EVENT_TARGET,
        row.id,
        tenant_id=row.tenant_id,
        details={
            "project_id": str(row.project_id),
            "host": host_of(row.address),
            **(details or {}),
        },
    )


@router.get("", operation_id="listEventTargets", **require(Permission.INTEGRATIONS))
async def list_event_targets(project_id: uuid.UUID, connection: TenantConnection) -> EventTargets:
    await live_project(connection, project_id)
    rows = (
        await connection.execute(
            select(event_targets)
            .where(event_targets.c.project_id == project_id)
            .order_by(event_targets.c.created_at)
        )
    ).all()
    return EventTargets(targets=[target_of_row(row) for row in rows])


@router.post(
    "",
    operation_id="saveEventTarget",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def save_event_target(
    project_id: uuid.UUID,
    draft: EventTargetDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> SavedEventTarget:
    await live_project(connection, project_id)
    await check_address(settings, draft.address)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    target_id = uuid.uuid4()
    secret = secrets.token_hex(32)
    keys = await ensure_keys(connection, keyring_of(request), tenant_id)
    await connection.execute(
        insert(event_targets).values(
            id=target_id,
            tenant_id=tenant_id,
            project_id=project_id,
            address=draft.address,
            events=list(dict.fromkeys(kind.value for kind in draft.events)),
            secret_ciphertext=seal_field(keys, TABLE, target_id, SECRET_FIELD, secret),
            created_by_user_id=user_of(principal),
        )
    )
    row = await target_row(connection, project_id, target_id)
    await audited(
        connection, principal, AuditAction.EVENT_TARGET_SAVED, row, {"events": list(row.events)}
    )
    return SavedEventTarget(**target_of_row(row).model_dump(), secret=secret)


@router.delete(
    "/{target_id}",
    operation_id="deleteEventTarget",
    status_code=204,
    **require(Permission.INTEGRATIONS, write=True),
)
async def delete_event_target(
    project_id: uuid.UUID,
    target_id: TargetId,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> None:
    row = await target_row(connection, project_id, target_id)
    await connection.execute(delete(event_targets).where(event_targets.c.id == target_id))
    await audited(connection, principal, AuditAction.EVENT_TARGET_DELETED, row)


@router.get(
    "/{target_id}/events",
    operation_id="listEventDeliveries",
    **require(Permission.INTEGRATIONS),
)
async def list_event_deliveries(
    project_id: uuid.UUID, target_id: TargetId, connection: TenantConnection
) -> EventDeliveries:
    await target_row(connection, project_id, target_id)
    rows = (
        await connection.execute(
            select(event_outbox)
            .where(event_outbox.c.target_id == target_id)
            .order_by(event_outbox.c.sequence.desc())
            .limit(LOG_SHOWN)
        )
    ).all()
    tries = (
        await connection.execute(
            select(event_attempts)
            .where(event_attempts.c.event_id.in_([row.id for row in rows]))
            .order_by(event_attempts.c.created_at)
        )
    ).all()
    log: dict[uuid.UUID, list[EventAttempt]] = {}
    for attempt in tries:
        log.setdefault(attempt.event_id, []).append(
            EventAttempt.model_validate(attempt, from_attributes=True)
        )
    return EventDeliveries(
        events=[
            EventDelivery(
                id=row.id,
                kind=EventKind(row.kind),
                sequence=row.sequence,
                status=EventStatus(row.status),
                attempts=row.attempts,
                next_attempt_at=row.next_attempt_at,
                delivered_at=row.delivered_at,
                created_at=row.created_at,
                log=log.get(row.id, []),
            )
            for row in rows
        ]
    )


@router.post(
    "/{target_id}/events/{event_id}/replay",
    operation_id="replayEvent",
    **require(Permission.INTEGRATIONS, write=True),
)
async def replay_event(
    project_id: uuid.UUID,
    target_id: TargetId,
    event_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> EventTarget:
    row = await target_row(connection, project_id, target_id)
    status = await connection.scalar(
        select(event_outbox.c.status).where(
            event_outbox.c.id == event_id, event_outbox.c.target_id == target_id
        )
    )
    if status is None:
        raise EventNotFoundError
    if status != EventStatus.FAILED:
        raise EventNotFailedError
    await connection.execute(
        update(event_outbox)
        .where(event_outbox.c.id == event_id)
        .values(
            status=EventStatus.PENDING,
            attempts=0,
            next_attempt_at=func.now(),
            lease_until=None,
        )
    )
    await connection.execute(
        update(event_targets)
        .where(event_targets.c.id == target_id)
        .values(paused_at=None, failures_in_row=0)
    )
    await audited(
        connection, principal, AuditAction.EVENT_REPLAYED, row, {"event_id": str(event_id)}
    )
    return target_of_row(await target_row(connection, project_id, target_id))
