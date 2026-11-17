import asyncio
import json
import logging
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.events_out import SECRET_FIELD, TABLE, host_of
from parfocal_api.identifiers import load_keys, open_field
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import notify
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import (
    ActorKind,
    AttemptOutcome,
    EventStatus,
    NotificationKind,
    event_attempts,
    event_outbox,
    event_targets,
    memberships,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.link_fetch import LinkPolicy, LinkRefusedError, policy_of, target_of
from parfocal_common.settings import load_settings
from parfocal_common.structured_logging import configure_logging
from parfocal_common.webhook_signing import (
    EVENT_ID_HEADER,
    EVENT_KIND_HEADER,
    SEQUENCE_HEADER,
    signed_headers,
)

logger = logging.getLogger("parfocal.events")

PLATFORM = DatabaseScope(platform=True)
DELIVERY = Actor(ActorKind.SYSTEM)
RETRY_WAITS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=2),
    timedelta(hours=12),
)
ANSWER_SECONDS = 10.0
LEASE = timedelta(seconds=60)
PAUSE_AFTER = 5
PAUSED_WAIT = timedelta(hours=12)
BATCH = 50


@dataclass(frozen=True)
class Delivery:
    event_id: uuid.UUID
    tenant_id: uuid.UUID


@dataclass(frozen=True)
class Outgoing:
    address: str
    body: bytes
    headers: dict[str, str]
    paused: bool


@dataclass(frozen=True)
class Answer:
    outcome: AttemptOutcome
    status_code: int | None
    duration_ms: int


def body_of(row: Any) -> bytes:
    document = {
        "id": str(row.id),
        "kind": row.kind,
        "sequence": row.sequence,
        "project_id": str(row.project_id),
        "occurred_at": row.created_at.astimezone(UTC).isoformat(),
        "data": row.body,
    }
    return json.dumps(document, separators=(",", ":"), sort_keys=True).encode()


async def claim_due(engine: AsyncEngine, now: datetime, limit: int = BATCH) -> list[Delivery]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        due = (
            select(event_outbox.c.id)
            .where(
                event_outbox.c.status == EventStatus.PENDING,
                event_outbox.c.next_attempt_at <= now,
                or_(event_outbox.c.lease_until.is_(None), event_outbox.c.lease_until < now),
            )
            .order_by(event_outbox.c.sequence)
            .with_for_update(skip_locked=True)
            .limit(limit)
        )
        rows = await connection.execute(
            update(event_outbox)
            .where(event_outbox.c.id.in_(due.scalar_subquery()))
            .values(lease_until=now + LEASE)
            .returning(event_outbox.c.id, event_outbox.c.tenant_id, event_outbox.c.sequence)
        )
        claimed = sorted(rows, key=lambda row: row.sequence)
        return [Delivery(row.id, row.tenant_id) for row in claimed]


async def outgoing_of(
    connection: AsyncConnection, keyring: MasterKeyring, delivery: Delivery, now: datetime
) -> Outgoing | None:
    row = (
        await connection.execute(select(event_outbox).where(event_outbox.c.id == delivery.event_id))
    ).one_or_none()
    if row is None:
        return None
    target = (
        await connection.execute(select(event_targets).where(event_targets.c.id == row.target_id))
    ).one()
    keys = await load_keys(connection, keyring, delivery.tenant_id)
    secret = open_field(keys, TABLE, target.id, SECRET_FIELD, target.secret_ciphertext)
    assert secret is not None
    body = body_of(row)
    headers = {
        "content-type": "application/json",
        EVENT_ID_HEADER: str(row.id),
        EVENT_KIND_HEADER: row.kind,
        SEQUENCE_HEADER: str(row.sequence),
        **signed_headers(secret, int(now.timestamp()), body),
    }
    return Outgoing(target.address, body, headers, target.paused_at is not None)


async def send(http: httpx2.AsyncClient, policy: LinkPolicy, outgoing: Outgoing) -> Answer:
    started = time.monotonic()

    def answer(outcome: AttemptOutcome, status_code: int | None = None) -> Answer:
        return Answer(outcome, status_code, int((time.monotonic() - started) * 1000))

    try:
        target = await target_of(httpx2.URL(outgoing.address), policy)
    except LinkRefusedError, httpx2.InvalidURL:
        return answer(AttemptOutcome.REFUSED)
    request = http.build_request(
        "POST",
        target.url,
        content=outgoing.body,
        headers={**outgoing.headers, **target.headers},
        extensions=target.extensions,
        timeout=ANSWER_SECONDS,
    )
    try:
        response = await http.send(request)
    except httpx2.TimeoutException:
        return answer(AttemptOutcome.TIMEOUT)
    except httpx2.HTTPError:
        return answer(AttemptOutcome.UNREACHABLE)
    if 200 <= response.status_code < 300:
        return answer(AttemptOutcome.DELIVERED, response.status_code)
    return answer(AttemptOutcome.STATUS, response.status_code)


async def admins_of(connection: AsyncConnection, tenant_id: uuid.UUID) -> Sequence[uuid.UUID]:
    found = await connection.scalars(
        select(memberships.c.user_id).where(
            memberships.c.tenant_id == tenant_id, memberships.c.admin_rights.is_(True)
        )
    )
    return found.all()


async def gave_up(
    connection: AsyncConnection, delivery: Delivery, target_id: uuid.UUID, now: datetime
) -> None:
    target = (
        await connection.execute(
            update(event_targets)
            .where(event_targets.c.id == target_id)
            .values(failures_in_row=event_targets.c.failures_in_row + 1)
            .returning(
                event_targets.c.failures_in_row,
                event_targets.c.paused_at,
                event_targets.c.project_id,
                event_targets.c.address,
            )
        )
    ).one()
    if target.failures_in_row < PAUSE_AFTER or target.paused_at is not None:
        return
    await connection.execute(
        update(event_targets).where(event_targets.c.id == target_id).values(paused_at=now)
    )
    await record(
        connection,
        DELIVERY,
        AuditAction.EVENT_TARGET_PAUSED,
        AuditTarget.EVENT_TARGET,
        target_id,
        tenant_id=delivery.tenant_id,
        details={
            "project_id": str(target.project_id),
            "host": host_of(target.address),
            "event_id": str(delivery.event_id),
        },
    )
    await notify(
        connection,
        delivery.tenant_id,
        await admins_of(connection, delivery.tenant_id),
        NotificationKind.INTEGRATION_DOWN,
        TargetKind.DELIVERY,
        delivery.event_id,
        {"target_id": str(target_id), "project_id": str(target.project_id)},
    )


async def settle(
    connection: AsyncConnection, delivery: Delivery, answer: Answer, now: datetime
) -> None:
    row = (
        await connection.execute(
            select(event_outbox.c.attempts, event_outbox.c.target_id)
            .where(event_outbox.c.id == delivery.event_id)
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        return
    await connection.execute(
        event_attempts.insert().values(
            tenant_id=delivery.tenant_id,
            event_id=delivery.event_id,
            outcome=answer.outcome,
            status_code=answer.status_code,
            duration_ms=answer.duration_ms,
        )
    )
    attempts = row.attempts + 1
    changes: dict[str, Any] = {"attempts": attempts, "lease_until": None}
    if answer.outcome is AttemptOutcome.DELIVERED:
        changes |= {"status": EventStatus.DELIVERED, "delivered_at": now}
        await connection.execute(
            update(event_targets)
            .where(event_targets.c.id == row.target_id)
            .values(failures_in_row=0)
        )
    elif attempts <= len(RETRY_WAITS):
        changes["next_attempt_at"] = now + RETRY_WAITS[attempts - 1]
    else:
        changes["status"] = EventStatus.FAILED
        await gave_up(connection, delivery, row.target_id, now)
    await connection.execute(
        update(event_outbox).where(event_outbox.c.id == delivery.event_id).values(**changes)
    )


async def hold(connection: AsyncConnection, delivery: Delivery, now: datetime) -> None:
    await connection.execute(
        update(event_outbox)
        .where(event_outbox.c.id == delivery.event_id)
        .values(lease_until=None, next_attempt_at=now + PAUSED_WAIT)
    )


async def deliver_one(
    engine: AsyncEngine,
    keyring: MasterKeyring,
    http: httpx2.AsyncClient,
    policy: LinkPolicy,
    delivery: Delivery,
    now: datetime,
) -> AttemptOutcome | None:
    scope = DatabaseScope(tenant_id=delivery.tenant_id)
    async with scoped_transaction(engine, scope) as connection:
        outgoing = await outgoing_of(connection, keyring, delivery, now)
        if outgoing is not None and outgoing.paused:
            await hold(connection, delivery, now)
            return None
    if outgoing is None:
        return None
    answer = await send(http, policy, outgoing)
    async with scoped_transaction(engine, scope) as connection:
        await settle(connection, delivery, answer, now)
    return answer.outcome


async def deliver_due(
    engine: AsyncEngine,
    keyring: MasterKeyring,
    http: httpx2.AsyncClient,
    policy: LinkPolicy,
    now: datetime | None = None,
) -> list[AttemptOutcome]:
    moment = now or datetime.now(UTC)
    outcomes: list[AttemptOutcome] = []
    for delivery in await claim_due(engine, moment):
        outcome = await deliver_one(engine, keyring, http, policy, delivery, moment)
        if outcome is not None:
            outcomes.append(outcome)
    return outcomes


def delivery_client() -> httpx2.AsyncClient:
    return httpx2.AsyncClient(
        timeout=httpx2.Timeout(ANSWER_SECONDS), follow_redirects=False, trust_env=False
    )


async def sweep(settings: ApiSettings) -> list[AttemptOutcome]:
    engine = create_engine(str(settings.database_url))
    keyring = MasterKeyring.from_setting(settings.master_keys.get_secret_value())
    try:
        async with delivery_client() as http:
            return await deliver_due(
                engine, keyring, http, policy_of(settings.link_trusted_origins)
            )
    finally:
        await engine.dispose()


def main() -> None:
    settings = load_settings(ApiSettings)
    configure_logging("events", settings.app_env)
    outcomes = asyncio.run(sweep(settings))
    logger.info("event sweep finished", extra={"count": len(outcomes)})


if __name__ == "__main__":
    main()
