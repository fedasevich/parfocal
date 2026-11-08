import hashlib
import json
import uuid
from collections.abc import Iterable, Sequence
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
    WORKSPACE_SETTINGS_CHANGED = "tenant.settings-changed"
    MEMBER_ADDED = "member.added"
    MEMBER_ROLE_CHANGED = "member.role-changed"
    MEMBER_ADMIN_RIGHTS_GIVEN = "member.admin-rights-given"
    MEMBER_ADMIN_RIGHTS_REMOVED = "member.admin-rights-removed"
    USER_SIGNED_IN = "user.signed-in"
    USER_SIGNED_OUT = "user.signed-out"
    SESSIONS_ENDED = "user.sessions-ended"
    PROFILE_CHANGED = "user.profile-changed"
    SESSION_POLICY_CHANGED = "tenant.session-policy-changed"
    SECURITY_CONTACT_CHANGED = "tenant.security-contact-changed"
    CASE_OPENED = "case.opened"
    CASE_CREATED = "case.created"
    CASE_PATIENT_VIEWED = "case.patient-viewed"
    PROJECT_EMERGENCY_ACCESS = "project.emergency-access"
    PROJECT_CREATED = "project.created"
    PROJECT_CHANGED = "project.changed"
    PROJECT_PRIVACY_CHANGED = "project.privacy-changed"
    PROJECT_ARCHIVED = "project.archived"
    PROJECT_RESTORED = "project.restored"
    PROJECT_DELETED = "project.deleted"
    SAMPLE_PROJECT_CREATED = "project.sample-created"
    PROJECT_MEMBER_SET = "project.member-set"
    PROJECT_MEMBER_REMOVED = "project.member-removed"
    PROJECT_SIGN_OUT_SET = "project.sign-out-set"
    PROJECT_TAXONOMY_CHANGED = "project.taxonomy-changed"
    PROJECT_MAPPINGS_CHANGED = "project.mappings-changed"
    PROJECT_OPINION_FORM_PUBLISHED = "project.opinion-form-published"
    STUDY_TEMPLATE_CREATED = "study-template.created"
    STUDY_TEMPLATE_EDITED = "study-template.edited"
    STUDY_TEMPLATE_RETIRED = "study-template.retired"
    STUDY_TEMPLATE_RESTORED = "study-template.restored"
    RESULT_SET_CREATED = "result-set.created"
    RESULT_SET_DELETED = "result-set.deleted"
    UPLOAD_COMPLETED = "upload.completed"
    UPLOAD_ABORTED = "upload.aborted"
    UPLOAD_LINKED = "upload.linked"
    UPLOAD_EXPIRED = "upload.expired"
    MODEL_RUN_STARTED = "model-run.started"
    MODEL_RUN_CANCELLED = "model-run.cancelled"
    MODEL_RUN_RESUMED = "model-run.resumed"
    MODEL_RUN_RETRIED = "model-run.retried"
    UPLOAD_REFUSED = "upload.refused"
    UPLOAD_PAIRED = "upload.paired"
    SLIDE_PUBLISHED = "slide.published"
    SLIDE_RESTRICTED_IMAGE_VIEWED = "slide.restricted-image-viewed"
    SLIDE_OPENED = "slide.opened"
    SLIDE_DETAILS_CHANGED = "slide.details-changed"
    CASE_SLIDES_REORDERED = "case.slides-reordered"
    CASE_SLIDE_MOVED = "case.slide-moved"
    TASK_CREATED = "task.created"
    TASK_CHANGED = "task.changed"
    TASK_NUDGED = "task.nudged"
    TASK_NUDGE_CANCELLED = "task.nudge-cancelled"
    TASK_REASSIGNED = "task.reassigned"
    TASK_REASSIGNMENT_UNDONE = "task.reassignment-undone"
    TASK_REVIEWER_ADDED = "task.reviewer-added"
    TASK_REVIEW_SUBMITTED = "task.review-submitted"
    TASK_REVIEW_REOPENED = "task.review-reopened"
    TASK_FIRST_READ_SUBMITTED = "task.first-read-submitted"
    TASK_SIGNED_OFF = "task.signed-off"
    TASK_SLIDE_CHECKED = "task.slide-checked"
    ANNOTATION_IMPORTED = "annotation.imported"
    TASK_SLIDE_UNCHECKED = "task.slide-unchecked"
    TASK_SLIDE_SIGNED_OFF = "task.slide-signed-off"
    TASK_REOPENED = "task.reopened"
    REVIEW_OBJECT_EDITED = "review.object-edited"
    REVIEW_OBJECT_RESTORED = "review.object-restored"
    REVIEW_OBJECT_SPLIT = "review.object-split"
    REVIEW_OBJECT_MERGED = "review.object-merged"
    REVIEW_VERDICT_SET = "review.verdict-set"
    REVIEW_VERDICT_CLEARED = "review.verdict-cleared"
    REVIEW_OBJECT_SKIPPED = "review.object-skipped"
    REVIEW_SKIP_CLEARED = "review.skip-cleared"
    REVIEW_DECISION_SET = "review.decision-set"
    REVIEW_DECISION_CLEARED = "review.decision-cleared"
    REVIEW_OBJECT_LEFT_OPEN = "review.object-left-open"
    REVIEW_LOOK_AGAIN_ASKED = "review.look-again-asked"
    REVIEW_DECISIONS_KEPT = "review.decisions-kept"
    REVIEW_ADJUDICATION_SENT = "review.adjudication-sent"
    REVIEW_ADJUDICATION_DECLINED = "review.adjudication-declined"
    REVIEW_OPINION_SAVED = "review.opinion-saved"
    THREAD_CREATED = "thread.created"
    THREAD_REPLIED = "thread.replied"
    THREAD_RESOLVED = "thread.resolved"
    THREAD_REOPENED = "thread.reopened"
    THREAD_DELETED = "thread.deleted"
    THREAD_MOVED = "thread.moved"
    AUDIT_EXPORTED = "audit.exported"
    SERVICE_ACCOUNT_CREATED = "service-account.created"
    SERVICE_ACCOUNT_DISABLED = "service-account.disabled"
    API_TOKEN_ISSUED = "api-token.issued"
    API_TOKEN_REVOKED = "api-token.revoked"
    INVITATION_CREATED = "invitation.created"
    INVITATION_REVOKED = "invitation.revoked"
    INVITATION_RESENT = "invitation.resent"
    INVITATION_ACCEPTED = "invitation.accepted"
    INVITATION_EXPIRED = "invitation.expired"
    ANNOUNCEMENT_POSTED = "announcement.posted"
    ANNOUNCEMENT_ENDED = "announcement.ended"
    SITE_VALIDATION_RECORDED = "site-validation.recorded"
    MODEL_TIER_SET = "model-tier.set"
    MODEL_TIER_RESET = "model-tier.reset"
    MODEL_HIDDEN = "model.hidden"
    MODEL_SHOWN = "model.shown"
    RETENTION_POLICY_SET = "retention.policy-set"
    RETENTION_PURGED = "retention.purged"
    LEGAL_HOLD_PLACED = "legal-hold.placed"
    LEGAL_HOLD_RELEASED = "legal-hold.released"
    AUDIT_PURGED = "audit.purged"
    PERSONAL_DATA_EXPORTED = "person.data-exported"
    PERSON_ERASED = "person.erased"
    PATIENT_DATA_EXPORTED = "patient.data-exported"
    PATIENT_ERASED = "patient.erased"
    TASK_COUNTS_AS_CHANGED = "task.counts-as-changed"
    TASK_DISPLAY_CHANGED = "task.display-changed"
    DISPLAY_PRESET_SAVED = "display-preset.saved"
    DISPLAY_PRESET_CHANGED = "display-preset.changed"
    DISPLAY_PRESET_DELETED = "display-preset.deleted"
    REPORT_LINK_CREATED = "report-link.created"
    REPORT_LINK_REVOKED = "report-link.revoked"
    REPORT_LINK_OPENED = "report-link.opened"
    CLINICAL_REPORT_CREATED = "clinical-report.created"
    CLINICAL_REPORT_CHANGED = "clinical-report.changed"
    CLINICAL_DEPOSIT_ADDED = "clinical-report.deposit-added"
    CLINICAL_DEPOSIT_REMOVED = "clinical-report.deposit-removed"
    CLINICAL_REPORT_SENT = "clinical-report.sent"
    CLINICAL_REPORT_WITHDRAWN = "clinical-report.withdrawn"
    CLINICAL_REPORT_RETURNED = "clinical-report.returned"
    CLINICAL_REPORT_SIGNED = "clinical-report.signed"
    CLINICAL_REPORT_AMENDED = "clinical-report.amended"


class AuditTarget(StrEnum):
    ORGANISATION = "organisation"
    TENANT = "tenant"
    PERSON = "person"
    CASE = "case"
    PROJECT = "project"
    RESULT_SET = "result-set"
    UPLOAD = "upload"
    MODEL_RUN = "model-run"
    REVIEW_TASK = "review-task"
    STUDY_TEMPLATE = "study-template"
    SERVICE_ACCOUNT = "service-account"
    INVITATION = "invitation"
    ANNOUNCEMENT = "announcement"
    SITE_VALIDATION = "site-validation"
    ANNOTATION = "annotation"
    SLIDE = "slide"
    LEGAL_HOLD = "legal-hold"
    PATIENT = "patient"
    THREAD = "thread"
    DISPLAY_PRESET = "display-preset"
    REPORT_LINK = "report-link"
    CLINICAL_REPORT = "clinical-report"


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


async def record_many(
    connection: AsyncConnection,
    actor: Actor,
    action: AuditAction,
    target_type: AuditTarget,
    target_ids: Sequence[uuid.UUID],
    *,
    tenant_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    if not target_ids:
        return
    actor_id = actor.service_id
    if actor.subject is not None:
        actor_id = await pseudonym_of(connection, actor.subject)
    await connection.execute(
        insert(audit_events),
        [
            {
                "tenant_id": tenant_id,
                "actor_kind": actor.kind,
                "actor_id": actor_id,
                "action": action,
                "target_type": target_type,
                "target_id": target_id,
                "details": canonical(details or {}),
            }
            for target_id in target_ids
        ],
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
