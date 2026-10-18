import base64
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, cast

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import Select, and_, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import (
    AuditAction,
    AuditEvent,
    AuditTarget,
    actor_of,
    canonical,
    event_of,
    record,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.tables import audit_events, audit_people, cases, patients, users
from parfocal_common.db import CURRENT_TENANT
from parfocal_common.envelope import MasterKeyring

EXPORT_FORMAT = "parfocal-audit-export"
SIGNING_INFO = b"parfocal audit export signing v1:"

router = APIRouter(prefix="/api/tenant", tags=["audit"])


class AuditFilters(BaseModel):
    person: uuid.UUID | None = None
    patient_id: uuid.UUID | None = None
    case_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    target_type: AuditTarget | None = None
    target_id: uuid.UUID | None = None
    action: list[str] | None = None
    action_prefix: str | None = None
    since: datetime | None = None
    until: datetime | None = None


def audit_filters(
    person: uuid.UUID | None = None,
    patient_id: uuid.UUID | None = None,
    case_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    target_type: AuditTarget | None = None,
    target_id: uuid.UUID | None = None,
    action: Annotated[list[str] | None, Query(max_length=20)] = None,
    action_prefix: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> AuditFilters:
    return AuditFilters(
        person=person,
        patient_id=patient_id,
        case_id=case_id,
        project_id=project_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        action_prefix=action_prefix,
        since=since,
        until=until,
    )


Filters = Annotated[AuditFilters, Depends(audit_filters)]


class ExportedEvent(AuditEvent):
    emergency: bool
    reason: str | None


class ChainHead(BaseModel):
    seq: int
    hash: str


class Signature(BaseModel):
    algorithm: Literal["Ed25519"] = "Ed25519"
    key_id: str
    value: str


class AuditExport(BaseModel):
    format: Literal["parfocal-audit-export"] = EXPORT_FORMAT
    version: Literal[1] = 1
    tenant_id: uuid.UUID
    generated_at: datetime
    filters: dict[str, Any]
    chain_head: ChainHead | None
    events: list[ExportedEvent]
    signature: Signature


class SigningKey(BaseModel):
    tenant_id: uuid.UUID
    key_id: str
    algorithm: Literal["Ed25519"] = "Ed25519"
    public_key: str
    current: bool


def keyring_of(request: Request) -> MasterKeyring:
    return cast("MasterKeyring", request.app.keyring)


def signing_key(master: bytes, tenant_id: uuid.UUID) -> Ed25519PrivateKey:
    seed = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=SIGNING_INFO + tenant_id.bytes
    ).derive(master)
    return Ed25519PrivateKey.from_private_bytes(seed)


def key_id_of(master_id: str) -> str:
    return f"{master_id}:audit-v1"


def encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def signed_bytes(document: dict[str, Any]) -> bytes:
    unsigned = {key: value for key, value in document.items() if key != "signature"}
    return canonical(unsigned).encode()


async def person_pseudonym(connection: AsyncConnection, user_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(
        select(audit_people.c.id)
        .join(users, users.c.subject == audit_people.c.subject)
        .where(users.c.id == user_id)
    )


async def filtered(connection: AsyncConnection, filters: AuditFilters) -> Select[tuple[Any, ...]]:
    actor = audit_people.alias("actor")
    target = audit_people.alias("target")
    statement = (
        select(
            audit_events,
            actor.c.subject.label("actor_subject"),
            target.c.subject.label("target_subject"),
        )
        .outerjoin(actor, actor.c.id == audit_events.c.actor_id)
        .outerjoin(
            target,
            and_(
                target.c.id == audit_events.c.target_id,
                audit_events.c.target_type == AuditTarget.PERSON,
            ),
        )
        .where(audit_events.c.tenant_id == literal_column(CURRENT_TENANT))
    )
    if filters.target_type is not None:
        statement = statement.where(audit_events.c.target_type == filters.target_type)
    if filters.target_id is not None:
        statement = statement.where(audit_events.c.target_id == filters.target_id)
    if filters.case_id is not None:
        statement = statement.where(
            audit_events.c.target_type == AuditTarget.CASE,
            audit_events.c.target_id == filters.case_id,
        )
    if filters.project_id is not None:
        statement = statement.where(
            audit_events.c.target_type == AuditTarget.PROJECT,
            audit_events.c.target_id == filters.project_id,
        )
    if filters.person is not None:
        pseudonym = await person_pseudonym(connection, filters.person)
        statement = statement.where(
            or_(
                audit_events.c.actor_id == pseudonym,
                and_(
                    audit_events.c.target_type == AuditTarget.PERSON,
                    audit_events.c.target_id == pseudonym,
                ),
            )
        )
    if filters.patient_id is not None:
        project = await connection.scalar(
            select(patients.c.project_id).where(patients.c.id == filters.patient_id)
        )
        their_cases = select(cases.c.id).where(cases.c.patient_id == filters.patient_id)
        statement = statement.where(
            or_(
                and_(
                    audit_events.c.target_type == AuditTarget.CASE,
                    audit_events.c.target_id.in_(their_cases),
                ),
                and_(
                    audit_events.c.target_type == AuditTarget.PROJECT,
                    audit_events.c.target_id == project,
                    audit_events.c.action == AuditAction.PROJECT_EMERGENCY_ACCESS,
                ),
            )
        )
    if filters.action:
        statement = statement.where(audit_events.c.action.in_(filters.action))
    if filters.action_prefix:
        statement = statement.where(audit_events.c.action.startswith(filters.action_prefix))
    if filters.since is not None:
        statement = statement.where(audit_events.c.occurred_at >= filters.since)
    if filters.until is not None:
        statement = statement.where(audit_events.c.occurred_at < filters.until)
    return statement.order_by(audit_events.c.seq)


def exported(event: AuditEvent) -> ExportedEvent:
    emergency = event.action == AuditAction.PROJECT_EMERGENCY_ACCESS
    reason = json.loads(event.details).get("reason") if emergency else None
    return ExportedEvent(**event.model_dump(), emergency=emergency, reason=reason)


@router.get("/audit-events", operation_id="listAuditEvents", **require(Permission.AUDIT_LOG))
async def list_audit_events(connection: TenantConnection, filters: Filters) -> list[AuditEvent]:
    rows = await connection.execute(await filtered(connection, filters))
    return [event_of(row) for row in rows]


@router.get(
    "/audit-events/export", operation_id="exportAuditEvents", **require(Permission.AUDIT_LOG)
)
async def export_audit_events(
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    filters: Filters,
) -> AuditExport:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    rows = await connection.execute(await filtered(connection, filters))
    events = [exported(event_of(row)) for row in rows]
    head = (
        await connection.execute(
            select(audit_events.c.seq, audit_events.c.hash)
            .where(audit_events.c.tenant_id == tenant_id)
            .order_by(audit_events.c.seq.desc())
            .limit(1)
        )
    ).one_or_none()
    keyring = keyring_of(request)
    unsigned = AuditExport(
        tenant_id=tenant_id,
        generated_at=datetime.now(UTC),
        filters=filters.model_dump(mode="json", exclude_none=True),
        chain_head=ChainHead(seq=head.seq, hash=bytes(head.hash).hex()) if head else None,
        events=events,
        signature=Signature(key_id=key_id_of(keyring.current), value=""),
    )
    document = unsigned.model_dump(mode="json")
    value = signing_key(keyring.keys[keyring.current], tenant_id).sign(signed_bytes(document))
    await record(
        connection,
        actor_of(principal),
        AuditAction.AUDIT_EXPORTED,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={"events": len(events), "filters": sorted(document["filters"])},
    )
    return unsigned.model_copy(
        update={"signature": Signature(key_id=key_id_of(keyring.current), value=encoded(value))}
    )


@router.get(
    "/audit-events/signing-keys",
    operation_id="listAuditSigningKeys",
    **require(Permission.AUDIT_LOG),
)
async def list_audit_signing_keys(
    request: Request, principal: CurrentPrincipal, connection: TenantConnection
) -> list[SigningKey]:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    keyring = keyring_of(request)
    return [
        SigningKey(
            tenant_id=tenant_id,
            key_id=key_id_of(master_id),
            public_key=encoded(
                signing_key(master, tenant_id)
                .public_key()
                .public_bytes(Encoding.Raw, PublicFormat.Raw)
            ),
            current=master_id == keyring.current,
        )
        for master_id, master in keyring.keys.items()
    ]
