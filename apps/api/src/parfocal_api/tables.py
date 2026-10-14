import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY

from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI, SECRET
from parfocal_common.db import metadata

SLUG_PATTERN = "^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"
DEFAULT_IDLE_LOCK_MINUTES = 15
DEFAULT_SESSION_HOURS = 12
DEFAULT_EMERGENCY_HOURS = 4


class TenantKind(StrEnum):
    DIAGNOSTIC = "diagnostic"
    RESEARCH = "research"
    SECOND_OPINION = "second-opinion"


class Region(StrEnum):
    EU = "eu"
    US = "us"


class Plan(StrEnum):
    PILOT = "pilot"


class Role(StrEnum):
    CONSULTANT = "consultant"
    RESIDENT = "resident"
    LEAD = "lead"
    LAB = "lab"
    OUTSIDE_CONSULTANT = "outside-consultant"
    ADMIN = "admin"


MEMBER_ROLE_CHECK = "role IN ('consultant', 'resident', 'lead', 'lab', 'admin')"


class TenantStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


def one_of(column: str, values: type[StrEnum]) -> CheckConstraint:
    allowed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{column} IN ({allowed})", name=column)


def timestamps() -> list[Column[datetime]]:
    return [
        Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            info=OPERATIONAL,
        ),
        Column(
            "updated_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            info=OPERATIONAL,
        ),
    ]


organisations = Table(
    "organisations",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column("slug", String(40), nullable=False, unique=True, info=OPERATIONAL),
    Column("name", String(200), nullable=False, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug"),
)

tenants = Table(
    "tenants",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "organisation_id",
        Uuid[uuid.UUID](),
        ForeignKey("organisations.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("slug", String(40), nullable=False, unique=True, info=OPERATIONAL),
    Column("name", String(200), nullable=False, info=OPERATIONAL),
    Column("kind", String(20), nullable=False, info=OPERATIONAL),
    Column("region", String(10), nullable=False, info=OPERATIONAL),
    Column("plan", String(20), nullable=False, info=OPERATIONAL),
    Column(
        "status",
        String(20),
        nullable=False,
        server_default=TenantStatus.ACTIVE.value,
        info=OPERATIONAL,
    ),
    Column("suspended_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug"),
    one_of("kind", TenantKind),
    one_of("region", Region),
    one_of("plan", Plan),
    one_of("status", TenantStatus),
    CheckConstraint("(status = 'suspended') = (suspended_at IS NOT NULL)", name="suspended_at"),
)

platform_operators = Table(
    "platform_operators",
    metadata,
    Column("subject", String(200), primary_key=True, info=PERSONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)

auth_logins = Table(
    "auth_logins",
    metadata,
    Column("state_hash", LargeBinary, primary_key=True, info=SECRET),
    Column("binding_hash", LargeBinary, nullable=False, info=SECRET),
    Column("code_verifier", String(200), nullable=False, info=SECRET),
    Column("nonce", String(200), nullable=False, info=SECRET),
    Column("return_to", String(2000), nullable=False, info=OPERATIONAL),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True, info=OPERATIONAL),
)

sessions = Table(
    "sessions",
    metadata,
    Column("id_hash", LargeBinary, primary_key=True, info=SECRET),
    Column(
        "id",
        Uuid[uuid.UUID](),
        nullable=False,
        unique=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column("subject", String(200), nullable=False, index=True, info=PERSONAL),
    Column("tokens", LargeBinary, nullable=False, info=SECRET),
    Column("access_expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True, info=OPERATIONAL),
    Column(
        "last_seen_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column(
        "active_tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        info=OPERATIONAL,
    ),
    Column(
        "active_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("user_agent", String(200), nullable=True, info=PERSONAL),
)

AVATAR_COLOURS = 12

users = Table(
    "users",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=PERSONAL,
    ),
    Column("subject", String(200), nullable=False, unique=True, info=PERSONAL),
    Column("email", String(320), nullable=True, info=PERSONAL),
    Column("display_name", String(200), nullable=False, info=PERSONAL),
    Column("initials", String(3), nullable=False, info=PERSONAL),
    Column("avatar_colour", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("title", String(40), nullable=True, info=PERSONAL),
    Column("signature", LargeBinary, nullable=True, info=PERSONAL),
    Column("signature_added_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "last_tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        info=OPERATIONAL,
    ),
    *timestamps(),
    CheckConstraint("initials ~ '^[A-Z]{1,3}$'", name="initials"),
    CheckConstraint("avatar_colour BETWEEN 0 AND 11", name="avatar_colour"),
    CheckConstraint(
        "(signature IS NULL) = (signature_added_at IS NULL)", name="signature_added_at"
    ),
)

memberships = Table(
    "memberships",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
        info=PERSONAL,
    ),
    Column("role", String(30), nullable=False, info=OPERATIONAL),
    Column("signs_alone", Boolean, nullable=True, info=OPERATIONAL),
    Column("all_folders", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column(
        "supervisor_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "user_id"),
    CheckConstraint(MEMBER_ROLE_CHECK, name="role"),
    CheckConstraint("supervisor_user_id IS DISTINCT FROM user_id", name="own_supervisor"),
    CheckConstraint("NOT all_folders OR role = 'lead'", name="all_folders"),
)


class ActorKind(StrEnum):
    USER = "user"
    MEMBER = "member"
    GUEST = "guest"
    OPERATOR = "operator"
    SYSTEM = "system"
    SERVICE = "service"


audit_people = Table(
    "audit_people",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=PERSONAL,
    ),
    Column("subject", String(200), nullable=False, unique=True, info=PERSONAL),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id", Uuid[uuid.UUID](), ForeignKey("tenants.id"), nullable=True, info=OPERATIONAL
    ),
    Column("seq", BigInteger, nullable=False, info=OPERATIONAL),
    Column("occurred_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("actor_kind", String(20), nullable=False, info=OPERATIONAL),
    Column("actor_id", Uuid[uuid.UUID](), nullable=True, info=PERSONAL),
    Column("action", String(60), nullable=False, info=OPERATIONAL),
    Column("target_type", String(40), nullable=False, info=OPERATIONAL),
    Column("target_id", Uuid[uuid.UUID](), nullable=True, info=PERSONAL),
    Column("details", Text, nullable=False, server_default="{}", info=OPERATIONAL),
    Column("prev_hash", LargeBinary, nullable=False, info=OPERATIONAL),
    Column("hash", LargeBinary, nullable=False, info=OPERATIONAL),
    UniqueConstraint("tenant_id", "seq", postgresql_nulls_not_distinct=True),
    Index(
        "ix_audit_events_tenant_id_target_type_target_id", "tenant_id", "target_type", "target_id"
    ),
    one_of("actor_kind", ActorKind),
)

SERVICE_SCOPES_CHECK = (
    "scopes <@ ARRAY['see-cases', 'edit-cases', 'upload-slides', 'see-team']::varchar[] "
    "AND cardinality(scopes) > 0"
)

service_accounts = Table(
    "service_accounts",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("name", String(100), nullable=False, info=OPERATIONAL),
    Column("scopes", ARRAY(String(40)), nullable=False, info=OPERATIONAL),
    Column("disabled_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("tenant_id", "name"),
    CheckConstraint(SERVICE_SCOPES_CHECK, name="scopes"),
)

api_tokens = Table(
    "api_tokens",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "service_account_id",
        Uuid[uuid.UUID](),
        ForeignKey("service_accounts.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("token_hash", LargeBinary, nullable=False, unique=True, info=SECRET),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("revoked_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("last_used_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)

invitations = Table(
    "invitations",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("email", String(320), nullable=False, info=PERSONAL),
    Column("role", String(30), nullable=False, info=OPERATIONAL),
    Column("token_hash", LargeBinary, nullable=False, unique=True, info=SECRET),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("accepted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("revoked_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    CheckConstraint(MEMBER_ROLE_CHECK, name="role"),
)

session_policies = Table(
    "session_policies",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("idle_lock_minutes", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("session_hours", SmallInteger, nullable=False, info=OPERATIONAL),
    Column(
        "emergency_hours",
        SmallInteger,
        nullable=False,
        server_default=str(DEFAULT_EMERGENCY_HOURS),
        info=OPERATIONAL,
    ),
    *timestamps(),
    CheckConstraint("idle_lock_minutes BETWEEN 1 AND 240", name="idle_lock_minutes"),
    CheckConstraint("session_hours BETWEEN 1 AND 24", name="session_hours"),
    CheckConstraint("emergency_hours BETWEEN 1 AND 24", name="emergency_hours"),
)


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    UNKNOWN = "unknown"


class KeyPurpose(StrEnum):
    DATA = "data"
    INDEX = "index"


tenant_keys = Table(
    "tenant_keys",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("purpose", String(10), primary_key=True, info=OPERATIONAL),
    Column("version", Integer, primary_key=True, info=OPERATIONAL),
    Column("master_id", String(40), nullable=False, info=OPERATIONAL),
    Column("wrapped_key", LargeBinary, nullable=False, info=SECRET),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    one_of("purpose", KeyPurpose),
    CheckConstraint("version BETWEEN 1 AND 65535", name="version"),
)

patients = Table(
    "patients",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("name_ciphertext", LargeBinary, nullable=False, info=PHI),
    Column("name_tokens", ARRAY(LargeBinary), nullable=False, info=PHI),
    Column("mrn_ciphertext", LargeBinary, nullable=True, info=PHI),
    Column("mrn_index", LargeBinary, nullable=True, info=PHI),
    Column("birth_date_ciphertext", LargeBinary, nullable=True, info=PHI),
    Column("birth_date_index", LargeBinary, nullable=True, info=PHI),
    Column("sex", String(10), nullable=False, server_default="unknown", info=PHI),
    Column("age_years", SmallInteger, nullable=True, info=PHI),
    *timestamps(),
    Column("deleted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    UniqueConstraint("tenant_id", "mrn_index"),
    Index("ix_patients_name_tokens", "name_tokens", postgresql_using="gin"),
    Index("ix_patients_birth_date_index", "tenant_id", "birth_date_index"),
    UniqueConstraint("id", "tenant_id"),
    one_of("sex", Sex),
    CheckConstraint("age_years BETWEEN 0 AND 150", name="age_years"),
)


class Priority(StrEnum):
    ROUTINE = "routine"
    URGENT = "urgent"
    ASAP = "asap"
    STAT = "stat"


class CaseState(StrEnum):
    WAITING_FOR_SLIDES = "waiting-for-slides"
    WAITING_FOR_AI = "waiting-for-ai"
    READY_TO_REVIEW = "ready-to-review"
    IN_REVIEW = "in-review"
    WAITING_ON_OTHERS = "waiting-on-others"
    REPORT_DRAFTED = "report-drafted"
    WITH_SUPERVISOR = "with-supervisor"
    SIGNED = "signed"
    AMENDING = "amending"
    CANCELLED = "cancelled"


class CaseSource(StrEnum):
    LIS = "lis"
    MANUAL = "manual"
    UPLOAD = "upload"


class Laterality(StrEnum):
    LEFT = "left"
    RIGHT = "right"
    BILATERAL = "bilateral"
    NOT_APPLICABLE = "not-applicable"
    UNKNOWN = "unknown"


def owned_ids() -> list[Column[uuid.UUID]]:
    return [
        Column(
            "id",
            Uuid[uuid.UUID](),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
            info=OPERATIONAL,
        ),
        Column(
            "tenant_id",
            Uuid[uuid.UUID](),
            ForeignKey("tenants.id"),
            nullable=False,
            index=True,
            info=OPERATIONAL,
        ),
    ]


def case_timestamps() -> list[Column[datetime]]:
    return [
        *timestamps(),
        Column("deleted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    ]


def case_column() -> Column[uuid.UUID]:
    return Column("case_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL)


cases = Table(
    "cases",
    metadata,
    *owned_ids(),
    Column("patient_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("accession", String(40), nullable=False, info=PHI),
    Column(
        "priority",
        String(10),
        nullable=False,
        server_default=Priority.ROUTINE.value,
        info=OPERATIONAL,
    ),
    Column("due_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "state",
        String(30),
        nullable=False,
        server_default=CaseState.WAITING_FOR_SLIDES.value,
        info=OPERATIONAL,
    ),
    Column("source", String(10), nullable=False, info=OPERATIONAL),
    Column(
        "assignee_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("clinical_note", LargeBinary, nullable=True, info=PHI),
    Column("clinical_question", LargeBinary, nullable=True, info=PHI),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("folder_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("service", String(60), nullable=True, info=OPERATIONAL),
    Column("requester", String(200), nullable=True, info=PERSONAL),
    Column("is_draft", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column(
        "state_changed_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("cancelled_from", String(30), nullable=True, info=OPERATIONAL),
    Column("cancelled_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("tenant_id", "accession"),
    UniqueConstraint("id", "tenant_id"),
    ForeignKeyConstraint(["patient_id", "tenant_id"], ["patients.id", "patients.tenant_id"]),
    one_of("priority", Priority),
    one_of("state", CaseState),
    one_of("source", CaseSource),
    CheckConstraint(
        "(state = 'cancelled') = (cancelled_from IS NOT NULL) "
        "AND (state = 'cancelled') = (cancelled_at IS NOT NULL) "
        "AND cancelled_from IS DISTINCT FROM 'cancelled' "
        "AND cancelled_from IS DISTINCT FROM 'signed' "
        "AND cancelled_from IS DISTINCT FROM 'amending'",
        name="cancelled",
    ),
    ForeignKeyConstraint(["folder_id", "tenant_id"], ["folders.id", "folders.tenant_id"]),
)

specimens = Table(
    "specimens",
    metadata,
    *owned_ids(),
    case_column(),
    Column("letter", String(2), nullable=False, info=OPERATIONAL),
    Column("type", String(200), nullable=True, info=PHI),
    Column("site", String(200), nullable=True, info=PHI),
    Column(
        "laterality",
        String(20),
        nullable=False,
        server_default=Laterality.UNKNOWN.value,
        info=PHI,
    ),
    Column("procedure", String(200), nullable=True, info=PHI),
    Column("collected_at", DateTime(timezone=True), nullable=True, info=PHI),
    Column("received_at", DateTime(timezone=True), nullable=True, info=PHI),
    *case_timestamps(),
    UniqueConstraint("case_id", "letter"),
    UniqueConstraint("id", "case_id", "tenant_id"),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
    CheckConstraint("letter ~ '^[A-Z]{1,2}$'", name="letter"),
    one_of("laterality", Laterality),
)

blocks = Table(
    "blocks",
    metadata,
    *owned_ids(),
    case_column(),
    Column("specimen_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("number", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("description", String(200), nullable=True, info=PHI),
    Column("stains", ARRAY(String(60)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("levels", SmallInteger, nullable=False, server_default="1", info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("specimen_id", "number"),
    UniqueConstraint("id", "case_id"),
    ForeignKeyConstraint(
        ["specimen_id", "case_id", "tenant_id"],
        ["specimens.id", "specimens.case_id", "specimens.tenant_id"],
    ),
    CheckConstraint("number BETWEEN 1 AND 999", name="number"),
    CheckConstraint("levels BETWEEN 1 AND 50", name="levels"),
)

slides = Table(
    "slides",
    metadata,
    *owned_ids(),
    case_column(),
    Column("block_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("barcode", String(100), nullable=True, info=PHI),
    Column("stain", String(60), nullable=False, server_default="H&E", info=OPERATIONAL),
    Column("level", SmallInteger, nullable=True, info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("tenant_id", "barcode"),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
    ForeignKeyConstraint(["block_id", "case_id"], ["blocks.id", "blocks.case_id"]),
)

accession_formats = Table(
    "accession_formats",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("template", String(60), nullable=False, info=OPERATIONAL),
    Column("prefixes", ARRAY(String(4)), nullable=False, info=OPERATIONAL),
    *timestamps(),
)

accession_counters = Table(
    "accession_counters",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("prefix", String(4), primary_key=True, info=OPERATIONAL),
    Column("year", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("last_value", Integer, nullable=False, info=OPERATIONAL),
)

case_requests = Table(
    "case_requests",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), primary_key=True, info=PERSONAL),
    Column("request_key", String(100), primary_key=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
)

folders = Table(
    "folders",
    metadata,
    *owned_ids(),
    Column("name", String(60), nullable=False, info=OPERATIONAL),
    Column("colour", SmallInteger, nullable=False, server_default="0", info=OPERATIONAL),
    Column("archived_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("tenant_id", "name"),
    UniqueConstraint("id", "tenant_id"),
    CheckConstraint("colour BETWEEN 0 AND 11", name="colour"),
)

folder_members = Table(
    "folder_members",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("folder_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=PERSONAL),
    ForeignKeyConstraint(["folder_id", "tenant_id"], ["folders.id", "folders.tenant_id"]),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
)

emergency_grants = Table(
    "emergency_grants",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), nullable=False, info=PERSONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("reason", String(500), nullable=False, info=PHI),
    Column(
        "granted_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
    ),
    Index("ix_emergency_grants_user_id_case_id", "user_id", "case_id"),
)
