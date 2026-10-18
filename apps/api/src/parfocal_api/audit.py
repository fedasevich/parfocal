import hashlib
import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete, insert, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.principals import (
    MemberPrincipal,
    PlatformOperator,
    Principal,
    ServicePrincipal,
    SignedInUser,
)
from parfocal_api.tables import ActorKind, audit_events, audit_people

GENESIS = bytes(32)


class AuditAction(StrEnum):
    ORGANISATION_CREATED = "organisation.created"
    TENANT_CREATED = "tenant.created"
    TENANT_SUSPENDED = "tenant.suspended"
    TENANT_REACTIVATED = "tenant.reactivated"
    MEMBER_ADDED = "member.added"
    MEMBER_ROLE_CHANGED = "member.role-changed"
    USER_SIGNED_IN = "user.signed-in"
    USER_SIGNED_OUT = "user.signed-out"
    SESSIONS_ENDED = "user.sessions-ended"
    SESSION_POLICY_CHANGED = "tenant.session-policy-changed"
    CASE_OPENED = "case.opened"
    CASE_CREATED = "case.created"
    PROJECT_EMERGENCY_ACCESS = "project.emergency-access"
    PROJECT_CREATED = "project.created"
    PROJECT_CHANGED = "project.changed"
    PROJECT_ARCHIVED = "project.archived"
    PROJECT_RESTORED = "project.restored"
    PROJECT_MEMBER_SET = "project.member-set"
    PROJECT_MEMBER_REMOVED = "project.member-removed"
    PROJECT_TAXONOMY_CHANGED = "project.taxonomy-changed"
    PROJECT_MAPPINGS_CHANGED = "project.mappings-changed"
    PROJECT_OPINION_FORM_PUBLISHED = "project.opinion-form-published"
    RESULT_SET_CREATED = "result-set.created"
    RESULT_SET_DELETED = "result-set.deleted"
    TASK_CREATED = "task.created"
    TASK_CHANGED = "task.changed"
    TASK_REVIEW_SUBMITTED = "task.review-submitted"
    TASK_REVIEW_REOPENED = "task.review-reopened"
    TASK_SIGNED_OFF = "task.signed-off"
    TASK_REOPENED = "task.reopened"
    REVIEW_OBJECT_EDITED = "review.object-edited"
    REVIEW_OBJECT_RESTORED = "review.object-restored"
    REVIEW_VERDICT_SET = "review.verdict-set"
    REVIEW_VERDICT_CLEARED = "review.verdict-cleared"
    REVIEW_DECISION_SET = "review.decision-set"
    REVIEW_DECISION_CLEARED = "review.decision-cleared"
    REVIEW_OPINION_SAVED = "review.opinion-saved"
    AUDIT_EXPORTED = "audit.exported"
    SERVICE_ACCOUNT_CREATED = "service-account.created"
    SERVICE_ACCOUNT_DISABLED = "service-account.disabled"
    API_TOKEN_ISSUED = "api-token.issued"
    API_TOKEN_REVOKED = "api-token.revoked"
    INVITATION_CREATED = "invitation.created"
    INVITATION_REVOKED = "invitation.revoked"
    INVITATION_ACCEPTED = "invitation.accepted"
    INVITATION_EXPIRED = "invitation.expired"
    ANNOUNCEMENT_POSTED = "announcement.posted"
    ANNOUNCEMENT_ENDED = "announcement.ended"
    RETENTION_POLICY_SET = "retention.policy-set"
    RETENTION_PURGED = "retention.purged"
    LEGAL_HOLD_PLACED = "legal-hold.placed"
    LEGAL_HOLD_RELEASED = "legal-hold.released"
    AUDIT_PURGED = "audit.purged"
    PERSONAL_DATA_EXPORTED = "person.data-exported"
    PERSON_ERASED = "person.erased"
    PATIENT_DATA_EXPORTED = "patient.data-exported"
    PATIENT_ERASED = "patient.erased"


class AuditTarget(StrEnum):
    ORGANISATION = "organisation"
    TENANT = "tenant"
    PERSON = "person"
    CASE = "case"
    PROJECT = "project"
    RESULT_SET = "result-set"
    REVIEW_TASK = "review-task"
    SERVICE_ACCOUNT = "service-account"
    INVITATION = "invitation"
    ANNOUNCEMENT = "announcement"
    ANNOTATION = "annotation"
    SLIDE = "slide"
    LEGAL_HOLD = "legal-hold"
    PATIENT = "patient"


@dataclass(frozen=True)
class Actor:
    kind: ActorKind
    subject: str | None = None
    service_id: uuid.UUID | None = None


class AuditEvent(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    seq: int
    occurred_at: datetime
    actor_kind: ActorKind
    actor_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: uuid.UUID | None
    details: str
    prev_hash: str
    hash: str
    actor_subject: str | None = None
    target_subject: str | None = None


def actor_of(principal: Principal) -> Actor:
    match principal:
        case MemberPrincipal(subject=subject):
            return Actor(ActorKind.MEMBER, subject)
        case SignedInUser(subject=subject):
            return Actor(ActorKind.USER, subject)
        case PlatformOperator(subject=subject):
            return Actor(ActorKind.OPERATOR, subject)
        case ServicePrincipal(account_id=account_id):
            return Actor(ActorKind.SERVICE, service_id=account_id)


def canonical(details: dict[str, Any]) -> str:
    return json.dumps(details, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


async def pseudonym_of(connection: AsyncConnection, subject: str) -> uuid.UUID:
    await connection.execute(
        upsert(audit_people)
        .values(subject=subject)
        .on_conflict_do_nothing(index_elements=[audit_people.c.subject])
    )
    pseudonym = await connection.scalar(
        select(audit_people.c.id).where(audit_people.c.subject == subject)
    )
    assert isinstance(pseudonym, uuid.UUID)
    return pseudonym


async def forget(connection: AsyncConnection, subject: str) -> bool:
    forgotten = await connection.scalar(
        delete(audit_people).where(audit_people.c.subject == subject).returning(audit_people.c.id)
    )
    return forgotten is not None


async def record(
    connection: AsyncConnection,
    actor: Actor,
    action: AuditAction,
    target_type: AuditTarget,
    target_id: uuid.UUID | None = None,
    *,
    person: str | None = None,
    tenant_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    actor_id = actor.service_id
    if actor.subject is not None:
        actor_id = await pseudonym_of(connection, actor.subject)
    if person is not None:
        target_id = await pseudonym_of(connection, person)
    await connection.execute(
        insert(audit_events).values(
            tenant_id=tenant_id,
            actor_kind=actor.kind,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=canonical(details or {}),
        )
    )


def event_of(row: Any) -> AuditEvent:
    values = dict(row._mapping)
    values["prev_hash"] = bytes(values["prev_hash"]).hex()
    values["hash"] = bytes(values["hash"]).hex()
    return AuditEvent.model_validate(values)


def field(value: object | None) -> str:
    if value is None:
        return "-"
    text = str(value)
    return f"{len(text)}:{text}"


def timestamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def event_hash(event: AuditEvent) -> str:
    payload = "".join(
        field(value)
        for value in (
            event.id,
            event.tenant_id,
            event.seq,
            timestamp(event.occurred_at),
            event.actor_kind,
            event.actor_id,
            event.action,
            event.target_type,
            event.target_id,
            event.details,
        )
    )
    return hashlib.sha256(bytes.fromhex(event.prev_hash) + payload.encode()).hexdigest()


def anchor_of(ordered: list[AuditEvent]) -> tuple[int, str]:
    if not ordered or ordered[0].seq == 1:
        return 1, GENESIS.hex()
    for event in ordered:
        if event.action == AuditAction.AUDIT_PURGED:
            details = json.loads(event.details)
            if details.get("through_seq") == ordered[0].seq - 1:
                return ordered[0].seq, str(details["last_hash"])
    return 1, GENESIS.hex()


def chain_breaks(events: Iterable[AuditEvent]) -> list[int]:
    ordered = sorted(events, key=lambda item: item.seq)
    expected_seq, expected_prev = anchor_of(ordered)
    breaks: list[int] = []
    for event in ordered:
        if (
            event.seq != expected_seq
            or event.prev_hash != expected_prev
            or event.hash != event_hash(event)
        ):
            breaks.append(event.seq)
        expected_seq = event.seq + 1
        expected_prev = event.hash
    return breaks
