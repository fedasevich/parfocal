import uuid
from datetime import datetime
from enum import StrEnum

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI, SECRET
from parfocal_common.db import metadata
from parfocal_common.jobs import job_steps as job_steps
from parfocal_common.jobs import job_units as job_units
from parfocal_common.jobs import jobs as jobs
from parfocal_common.model_runs import ModelTier
from parfocal_common.model_runs import model_runs as model_runs
from parfocal_common.pairing import Certainty, Rule
from parfocal_common.result_imports import ResultFormat, UploadKind
from parfocal_common.stage_throughput import stage_throughput as stage_throughput

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
    RESEARCHER = "researcher"
    REVIEWER = "reviewer"


MEMBER_ROLE_CHECK = "role IN ('researcher', 'reviewer')"
ADMIN_RIGHTS_CHECK = "NOT admin_rights OR role = 'researcher'"


def admin_rights_column() -> Column[bool]:
    return Column(
        "admin_rights", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL
    )


class ProjectRole(StrEnum):
    OWNER = "owner"
    REVIEWER = "reviewer"
    VIEWER = "viewer"


class SignOutRight(StrEnum):
    OWN_CASES = "own"
    ANY_CASE = "any"
    NEVER = "never"


class Availability(StrEnum):
    AVAILABLE = "available"
    AWAY = "away"


AVAILABILITY_CHECK = (
    "availability = 'away'"
    " OR (availability = 'available' AND available_again_at IS NULL AND availability_note IS NULL)"
)


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
    Column("email_digest", String(10), nullable=False, server_default="off", info=OPERATIONAL),
    Column("quiet_from", Time, nullable=True, info=OPERATIONAL),
    Column("quiet_until", Time, nullable=True, info=OPERATIONAL),
    Column("time_zone", String(60), nullable=False, server_default="UTC", info=OPERATIONAL),
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
    CheckConstraint("email_digest IN ('off', 'hourly', 'daily')", name="email_digest"),
    CheckConstraint("(quiet_from IS NULL) = (quiet_until IS NULL)", name="quiet_hours"),
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
    admin_rights_column(),
    Column(
        "availability",
        String(10),
        nullable=False,
        server_default=Availability.AVAILABLE.value,
        info=OPERATIONAL,
    ),
    Column("available_again_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("availability_note", String(200), nullable=True, info=PERSONAL),
    *timestamps(),
    UniqueConstraint("tenant_id", "user_id"),
    CheckConstraint(MEMBER_ROLE_CHECK, name="role"),
    CheckConstraint(ADMIN_RIGHTS_CHECK, name="admin_rights"),
    CheckConstraint(AVAILABILITY_CHECK, name="availability"),
)


class ActorKind(StrEnum):
    USER = "user"
    MEMBER = "member"
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
    "scopes <@ ARRAY['see-slides', 'create-cases', 'upload-slides', 'see-people']::varchar[] "
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
    admin_rights_column(),
    Column("token_hash", LargeBinary, nullable=False, unique=True, info=SECRET),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=True,
        index=True,
        info=OPERATIONAL,
    ),
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
    CheckConstraint(ADMIN_RIGHTS_CHECK, name="admin_rights"),
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


class PrivacyMode(StrEnum):
    DE_IDENTIFIED = "de-identified"
    CLINICAL = "clinical"


class AnalysisTemplate(StrEnum):
    NONE = "none"
    SENTINEL_NODE = "sentinel-node"
    CELL_REVIEW = "cell-review"


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
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.CLINICAL.value,
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
    UniqueConstraint("project_id", "mrn_index"),
    Index("ix_patients_name_tokens", "name_tokens", postgresql_using="gin"),
    Index("ix_patients_birth_date_index", "project_id", "birth_date_index"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["project_id", "privacy_mode"], ["projects.id", "projects.privacy_mode"]),
    CheckConstraint("privacy_mode = 'clinical'", name="clinical_only"),
    one_of("sex", Sex),
    CheckConstraint("age_years BETWEEN 0 AND 150", name="age_years"),
)


class CaseSource(StrEnum):
    MANUAL = "manual"
    UPLOAD = "upload"
    IMPORT = "import"


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


projects = Table(
    "projects",
    metadata,
    *owned_ids(),
    Column("number", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column(
        "name_lower",
        Text,
        Computed("lower(name)", persisted=True),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.DE_IDENTIFIED.value,
        info=OPERATIONAL,
    ),
    *case_timestamps(),
    Column("colour", SmallInteger, nullable=False, server_default="0", info=OPERATIONAL),
    Column(
        "template",
        String(20),
        nullable=False,
        server_default=AnalysisTemplate.NONE.value,
        info=OPERATIONAL,
    ),
    Column("archived_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("sample", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    UniqueConstraint("tenant_id", "number"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "privacy_mode"),
    Index(
        "ix_projects_tenant_id_sample",
        "tenant_id",
        unique=True,
        postgresql_where=text("sample AND deleted_at IS NULL"),
    ),
    CheckConstraint("number BETWEEN 1 AND 9999", name="number"),
    CheckConstraint("colour BETWEEN 0 AND 11", name="colour"),
    one_of("privacy_mode", PrivacyMode),
    one_of("template", AnalysisTemplate),
)

project_members = Table(
    "project_members",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=PERSONAL),
    Column("role", String(10), nullable=False, info=OPERATIONAL),
    Column("sign_out", String(10), nullable=True, info=OPERATIONAL),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("role", ProjectRole),
    one_of("sign_out", SignOutRight),
)

cases = Table(
    "cases",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("patient_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("label", String(100), nullable=False, info=PHI),
    Column("label_lower", Text, Computed("lower(label)", persisted=True), nullable=False, info=PHI),
    Column("source", String(10), nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *case_timestamps(),
    UniqueConstraint("project_id", "label"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["patient_id", "project_id"], ["patients.id", "patients.project_id"]),
    one_of("source", CaseSource),
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
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("block_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("label", String(200), nullable=False, info=PHI),
    Column("label_lower", Text, Computed("lower(label)", persisted=True), nullable=False, info=PHI),
    Column("barcode", String(100), nullable=True, info=PHI),
    Column("stain", String(60), nullable=False, server_default="H&E", info=OPERATIONAL),
    Column("level", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("position", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("upload_id", Uuid[uuid.UUID](), nullable=True, unique=True, info=OPERATIONAL),
    Column("format", String(30), nullable=True, info=OPERATIONAL),
    Column("variant", String(30), nullable=True, info=OPERATIONAL),
    Column("reader", String(20), nullable=True, info=OPERATIONAL),
    Column("width", Integer, nullable=True, info=OPERATIONAL),
    Column("height", Integer, nullable=True, info=OPERATIONAL),
    Column("level_count", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("mpp_x", Float[float](), nullable=True, info=OPERATIONAL),
    Column("mpp_y", Float[float](), nullable=True, info=OPERATIONAL),
    Column("objective_power", Float[float](), nullable=True, info=OPERATIONAL),
    Column("notices", ARRAY(String(40)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("file_bytes", BigInteger, nullable=True, info=OPERATIONAL),
    Column("sha256", String(64), nullable=True, info=OPERATIONAL),
    Column("original_key", String(300), nullable=True, info=OPERATIONAL),
    Column(
        "restricted_images",
        ARRAY(String(10)),
        nullable=False,
        server_default="{}",
        info=OPERATIONAL,
    ),
    Column("published_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("project_id", "barcode"),
    UniqueConstraint("id", "project_id"),
    Index(
        "ix_slides_case_id_label",
        "case_id",
        "label",
        unique=True,
        postgresql_where=text("deleted_at IS NULL"),
    ),
    Index(
        "ix_slides_project_id_label",
        "project_id",
        "label",
        unique=True,
        postgresql_where=text("case_id IS NULL AND deleted_at IS NULL"),
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
    ForeignKeyConstraint(["block_id", "case_id"], ["blocks.id", "blocks.case_id"]),
    ForeignKeyConstraint(["upload_id", "project_id"], ["uploads.id", "uploads.project_id"]),
    CheckConstraint("block_id IS NULL OR case_id IS NOT NULL", name="block_in_case"),
    CheckConstraint("upload_id IS NULL OR original_key IS NOT NULL", name="uploaded_file"),
)

project_classes = Table(
    "project_classes",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("key", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(60), nullable=False, info=OPERATIONAL),
    Column("colour", String(7), nullable=False, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("project_id", "key", deferrable=True, initially="DEFERRED"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("key BETWEEN 1 AND 9", name="key"),
    CheckConstraint("colour ~ '^#[0-9a-f]{6}$'", name="colour"),
    Index(
        "ix_project_classes_project_id_name", "project_id", func.lower(text("name")), unique=True
    ),
)

class_mappings = Table(
    "class_mappings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("source_name", String(120), primary_key=True, info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        ondelete="CASCADE",
    ),
)

opinion_forms = Table(
    "opinion_forms",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("questions", JSONB, nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    UniqueConstraint("project_id", "version"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("version >= 1", name="version"),
)


class EmailDigest(StrEnum):
    OFF = "off"
    HOURLY = "hourly"
    DAILY = "daily"


class NotificationKind(StrEnum):
    MENTION = "mention"
    REPLY = "reply"
    TASK_ASSIGNED = "task-assigned"
    MODEL_RUN_FINISHED = "model-run-finished"
    MODEL_RUN_PAUSED = "model-run-paused"
    UPLOAD_DONE = "upload-done"
    UPLOAD_REFUSED = "upload-refused"
    DISAGREEMENTS_READY = "disagreements-ready"
    TASK_SIGNED_OFF = "task-signed-off"
    EMERGENCY_ACCESS = "emergency-access"
    TASK_DUE_SOON = "task-due-soon"
    TASK_NUDGED = "task-nudged"
    TASK_REASSIGNED = "task-reassigned"
    TASK_DUE_CHANGED = "task-due-changed"
    RESULT_SET_ADDED = "result-set-added"
    INTEGRATION_DOWN = "integration-down"


class EmailStatus(StrEnum):
    NONE = "none"
    PENDING = "pending"
    SENT = "sent"
    SKIPPED = "skipped"


notifications = Table(
    "notifications",
    metadata,
    *owned_ids(),
    Column("user_id", Uuid[uuid.UUID](), nullable=False, info=PERSONAL),
    Column("kind", String(30), nullable=False, info=OPERATIONAL),
    Column("target_type", String(30), nullable=False, info=OPERATIONAL),
    Column("target_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("payload", JSONB, nullable=False, server_default="{}", info=OPERATIONAL),
    Column("in_app", Boolean, nullable=False, info=OPERATIONAL),
    Column("realtime", Boolean, nullable=False, info=OPERATIONAL),
    Column("email_status", String(10), nullable=False, info=OPERATIONAL),
    Column("emailed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("read_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("project_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("muted", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("kind", NotificationKind),
    CheckConstraint("email_status IN ('none', 'pending', 'sent', 'skipped')", name="email"),
    Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
    Index(
        "ix_notifications_pending_email",
        "tenant_id",
        postgresql_where=text("email_status = 'pending'"),
    ),
    Index(
        "ix_notifications_user_id_unread",
        "user_id",
        "kind",
        postgresql_where=text("read_at IS NULL"),
    ),
)


class MuteSubject(StrEnum):
    PROJECT = "project"
    TASK = "task"
    CASE = "case"


notification_mutes = Table(
    "notification_mutes",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("subject", String(10), primary_key=True, info=OPERATIONAL),
    Column("subject_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("subject", MuteSubject),
)

personal_settings = Table(
    "personal_settings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("values", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=PERSONAL),
    Column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
)

workspace_settings = Table(
    "workspace_settings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("values", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=OPERATIONAL),
    Column("locked", ARRAY(String(40)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
)

notification_preferences = Table(
    "notification_preferences",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(30), primary_key=True, info=OPERATIONAL),
    Column("in_app", Boolean, nullable=False, info=OPERATIONAL),
    Column("email", Boolean, nullable=False, info=OPERATIONAL),
    Column("realtime", Boolean, nullable=False, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("kind", NotificationKind),
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
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.CLINICAL.value,
        info=OPERATIONAL,
    ),
    Column("reason", String(500), nullable=False, info=PHI),
    Column(
        "granted_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["project_id", "privacy_mode"], ["projects.id", "projects.privacy_mode"]),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
    ),
    Index("ix_emergency_grants_user_id_project_id", "user_id", "project_id"),
    CheckConstraint("privacy_mode = 'clinical'", name="clinical_only"),
)


class AnnotationKind(StrEnum):
    ROI = "roi"
    MEASUREMENT = "measurement"
    REGION = "region"
    CELL = "cell"


class AnnotationChange(StrEnum):
    CREATED = "created"
    EDITED = "edited"
    DELETED = "deleted"
    RESTORED = "restored"


slide_counters = Table(
    "slide_counters",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("letter", String(1), primary_key=True, info=OPERATIONAL),
    Column("last", Integer, nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["slide_id"], ["slides.id"]),
    CheckConstraint("letter IN ('T', 'C', 'R', 'Z', 'M')", name="letter"),
    CheckConstraint("last >= 0", name="last"),
)

annotations = Table(
    "annotations",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("kind", String(20), nullable=False, info=OPERATIONAL),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column[object](
        "geometry",
        Geometry(spatial_index=False),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("version", Integer, nullable=False, server_default="1", info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *case_timestamps(),
    UniqueConstraint("slide_id", "kind", "number"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(
        ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    Index("ix_annotations_geometry", "geometry", postgresql_using="gist"),
    one_of("kind", AnnotationKind),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint("version > 0", name="version"),
    CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
)

annotation_versions = Table(
    "annotation_versions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("annotation_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("version", Integer, primary_key=True, info=OPERATIONAL),
    Column("change", String(20), nullable=False, info=OPERATIONAL),
    Column[object](
        "geometry",
        Geometry(spatial_index=False),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "changed_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "changed_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["annotation_id"], ["annotations.id"]),
    one_of("change", AnnotationChange),
)


class ResultSource(StrEnum):
    IMPORT = "import"
    RUN = "run"


class ResultStatus(StrEnum):
    IMPORTING = "importing"
    READY = "ready"
    FAILED = "failed"


class ResultObjectKind(StrEnum):
    REGION = "region"
    ZONE = "zone"


result_sets = Table(
    "result_sets",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("model_version", String(60), nullable=True, info=OPERATIONAL),
    Column("source", String(10), nullable=False, info=OPERATIONAL),
    Column("source_file", String(255), nullable=True, info=PHI),
    Column("produced_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "status",
        String(10),
        nullable=False,
        server_default=ResultStatus.IMPORTING.value,
        info=OPERATIONAL,
    ),
    Column("error_code", String(60), nullable=True, info=OPERATIONAL),
    Column("cell_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("region_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("zone_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *case_timestamps(),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(["job_id"], ["jobs.id"]),
    one_of("source", ResultSource),
    one_of("status", ResultStatus),
    CheckConstraint("cell_count >= 0 AND region_count >= 0 AND zone_count >= 0", name="counts"),
)

result_set_classes = Table(
    "result_set_classes",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("position", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("source_name", String(120), nullable=False, info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("object_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    UniqueConstraint("result_set_id", "source_name"),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
    ),
    ForeignKeyConstraint(
        ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    CheckConstraint("position BETWEEN 0 AND 254", name="position"),
    CheckConstraint("object_count >= 0", name="object_count"),
)

result_objects = Table(
    "result_objects",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column[object]("geometry", Geometry(spatial_index=False), nullable=False, info=OPERATIONAL),
    Column("class_index", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("score", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("probabilities", ARRAY(SmallInteger), nullable=True, info=OPERATIONAL),
    Column("parent_number", Integer, nullable=True, info=OPERATIONAL),
    ForeignKeyConstraint(["result_set_id"], ["result_sets.id"]),
    Index("ix_result_objects_geometry", "geometry", postgresql_using="gist"),
    one_of("kind", ResultObjectKind),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint("score BETWEEN 0 AND 255", name="score"),
    CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
)

result_chunks = Table(
    "result_chunks",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("chunk", Integer, primary_key=True, info=OPERATIONAL),
    Column("x", Integer, nullable=False, info=OPERATIONAL),
    Column("y", Integer, nullable=False, info=OPERATIONAL),
    Column("width", Integer, nullable=False, info=OPERATIONAL),
    Column("height", Integer, nullable=False, info=OPERATIONAL),
    Column("cell_count", Integer, nullable=False, info=OPERATIONAL),
    Column("vertex_count", Integer, nullable=False, info=OPERATIONAL),
    Column("object_key", String(300), nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["result_set_id"], ["result_sets.id"]),
    CheckConstraint("chunk >= 0", name="chunk"),
    CheckConstraint("width > 0 AND height > 0", name="size"),
    CheckConstraint("cell_count > 0 AND vertex_count >= 0", name="counts"),
)


class StudyKind(StrEnum):
    REGIONS_AND_CELLS = "regions-and-cells"
    REGIONS = "regions"
    OUTLINES = "outlines"
    CELLS = "cells"
    REVIEWERS_FIRST = "reviewers-first"
    OTHER = "other"


class BuiltInTemplate(StrEnum):
    SENTINEL_NODE = "sentinel-node"
    DETECTION = "detection"
    SEGMENTATION = "segmentation"
    CELL_TYPING = "cell-typing"
    READER_STUDY = "reader-study"


study_templates = Table(
    "study_templates",
    metadata,
    *owned_ids(),
    Column("built_in", String(20), nullable=True, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("retired_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "built_in"),
    UniqueConstraint("id", "tenant_id"),
    one_of("built_in", BuiltInTemplate),
    CheckConstraint("version >= 1", name="version"),
)

study_template_versions = Table(
    "study_template_versions",
    metadata,
    *owned_ids(),
    Column("template_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("study_kind", String(20), nullable=False, info=OPERATIONAL),
    Column("blocks", JSONB, nullable=False, info=OPERATIONAL),
    Column("format", JSONB, nullable=False, info=OPERATIONAL),
    Column("presets", JSONB, nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    UniqueConstraint("template_id", "version"),
    UniqueConstraint("template_id", "version", "tenant_id"),
    ForeignKeyConstraint(
        ["template_id", "tenant_id"],
        ["study_templates.id", "study_templates.tenant_id"],
        name="fk_study_template_versions_study_templates",
    ),
    one_of("study_kind", StudyKind),
    CheckConstraint("version >= 1", name="version"),
)


class TaskSplit(StrEnum):
    EVERYONE = "everyone"
    EVEN = "even"
    CHOSEN = "chosen"


class TaskScope(StrEnum):
    ALL_REGIONS = "all-regions"
    RANDOM_CELLS = "random-cells"
    CELLS_BELOW_SCORE = "cells-below-score"
    INSIDE_ROIS = "inside-rois"
    UNSURE_ZONES = "unsure-zones"


class StartMode(StrEnum):
    GUIDED = "guided"
    VIEWER = "viewer"


class DecisionStyle(StrEnum):
    CERTAINTY = "certainty"
    AGREE = "agree"
    YES_NO = "yes-no"
    BLIND = "blind"


DEFAULT_COUNTS_AS = ("disagree", "disagree", "unsure", "agree", "agree")


review_tasks = Table(
    "review_tasks",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("split", String(10), nullable=False, info=OPERATIONAL),
    Column("scope", String(20), nullable=False, info=OPERATIONAL),
    Column("scope_count", Integer, nullable=True, info=OPERATIONAL),
    Column("scope_seed", BigInteger, nullable=True, info=OPERATIONAL),
    Column("scope_score", SmallInteger, nullable=True, info=OPERATIONAL),
    Column(
        "extra_scopes", JSONB, nullable=False, server_default=text("'[]'::jsonb"), info=OPERATIONAL
    ),
    Column("opinion_form_version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("blinded", Boolean, nullable=False, server_default=text("true"), info=OPERATIONAL),
    Column(
        "ai_hidden_first_read",
        Boolean,
        nullable=False,
        server_default=text("false"),
        info=OPERATIONAL,
    ),
    Column("start_mode", String(10), nullable=False, info=OPERATIONAL),
    Column("due_on", Date, nullable=True, info=OPERATIONAL),
    Column(
        "reminder_days",
        ARRAY(SmallInteger),
        nullable=False,
        server_default=text("'{}'"),
        info=OPERATIONAL,
    ),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("archived_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("signed_off_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "signed_off_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("study_template_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("study_template_version", SmallInteger, nullable=True, info=OPERATIONAL),
    Column(
        "decision_style",
        String(10),
        nullable=False,
        server_default=DecisionStyle.CERTAINTY.value,
        info=OPERATIONAL,
    ),
    Column(
        "counts_as",
        ARRAY(String(10)),
        nullable=False,
        server_default=text("'{" + ",".join(DEFAULT_COUNTS_AS) + "}'"),
        info=OPERATIONAL,
    ),
    Column(
        "counts_as_changes",
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        info=PERSONAL,
    ),
    Column("question", String(200), nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("project_id", "number"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["project_id", "opinion_form_version"],
        ["opinion_forms.project_id", "opinion_forms.version"],
    ),
    ForeignKeyConstraint(
        ["study_template_id", "study_template_version", "tenant_id"],
        [
            "study_template_versions.template_id",
            "study_template_versions.version",
            "study_template_versions.tenant_id",
        ],
        name="fk_review_tasks_study_template_versions",
    ),
    CheckConstraint(
        "(study_template_id IS NULL) = (study_template_version IS NULL)", name="study_template"
    ),
    one_of("split", TaskSplit),
    one_of("scope", TaskScope),
    one_of("start_mode", StartMode),
    one_of("decision_style", DecisionStyle),
    CheckConstraint(
        "cardinality(counts_as) = 5 AND "
        "counts_as <@ ARRAY['agree', 'disagree', 'unsure']::varchar[] AND "
        "'agree' = ANY(counts_as) AND 'disagree' = ANY(counts_as)",
        name="counts_as",
    ),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint(
        "(scope = 'random-cells') = (scope_count IS NOT NULL AND scope_seed IS NOT NULL)",
        name="random_cells",
    ),
    CheckConstraint("scope_count IS NULL OR scope_count BETWEEN 1 AND 10000", name="scope_count"),
    CheckConstraint(
        "(scope = 'cells-below-score') = (scope_score IS NOT NULL)", name="cells_below_score"
    ),
    CheckConstraint("scope_score IS NULL OR scope_score BETWEEN 0 AND 255", name="scope_score"),
    CheckConstraint("cardinality(reminder_days) <= 3", name="reminders"),
)

review_task_slides = Table(
    "review_task_slides",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=OPERATIONAL),
    Column("position", Integer, nullable=False, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    UniqueConstraint("task_id", "position"),
    ForeignKeyConstraint(["task_id", "project_id"], ["review_tasks.id", "review_tasks.project_id"]),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
    ),
)

review_assignments = Table(
    "review_assignments",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=PERSONAL),
    Column("submitted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "assigned_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("first_read_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("first_read", JSONB(none_as_null=True), nullable=True, info=PHI),
    Column("released_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
    ),
    CheckConstraint("(first_read_at IS NULL) = (first_read IS NULL)", name="first_read_pair"),
)


class ReassignWhat(StrEnum):
    NOT_STARTED = "not-started"
    ALL = "all"


task_nudges = Table(
    "task_nudges",
    metadata,
    *owned_ids(),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column(
        "sent_by_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL
    ),
    Column(
        "sent_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)

task_reassignments = Table(
    "task_reassignments",
    metadata,
    *owned_ids(),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "from_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL
    ),
    Column("to_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column("what", String(12), nullable=False, info=OPERATIONAL),
    Column("slide_ids", ARRAY(Uuid[uuid.UUID]()), nullable=False, info=OPERATIONAL),
    Column("kept_slide_ids", ARRAY(Uuid[uuid.UUID]()), nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("undone_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    one_of("what", ReassignWhat),
    CheckConstraint("from_user_id <> to_user_id", name="two_people"),
)

review_order = Table(
    "review_order",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("seed", BigInteger, nullable=False, info=OPERATIONAL),
    Column("count", Integer, nullable=False, info=OPERATIONAL),
    Column("objects", LargeBinary, nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("count >= 0", name="count"),
    CheckConstraint("octet_length(objects) = 5 * count", name="packed"),
)


review_edits = Table(
    "review_edits",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("split", String(26), primary_key=True, server_default=text("''"), info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column[object]("geometry", Geometry(spatial_index=False), nullable=True, info=OPERATIONAL),
    Column("deleted", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column("retired", String(10), nullable=True, info=OPERATIONAL),
    Column("merged_into_number", Integer, nullable=True, info=OPERATIONAL),
    Column("merged_into_split", String(26), nullable=True, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint(
        "deleted OR retired IS NOT NULL OR class_id IS NOT NULL OR geometry IS NOT NULL",
        name="changes_something",
    ),
    CheckConstraint("geometry IS NULL OR ST_IsValid(geometry)", name="geometry_valid"),
    CheckConstraint("split ~ '^[a-z]*$'", name="split"),
    CheckConstraint("retired IN ('split', 'merged')", name="retired"),
    CheckConstraint(
        "(retired = 'merged') = (merged_into_number IS NOT NULL AND merged_into_split IS NOT NULL)",
        name="merged_into",
    ),
)


class VerdictValue(StrEnum):
    AGREE = "agree"
    DISAGREE = "disagree"
    UNSURE = "unsure"


class VerdictReason(StrEnum):
    NOT_CLASS = "not_class"
    BOUNDARY_OFF = "boundary_off"
    TWO_REGIONS = "two_regions"
    ARTEFACT = "artefact"
    NOT_A_CELL = "not_a_cell"
    WRONG_CLASS = "wrong_class"
    NEED_DEEPER_LEVEL = "need_deeper_level"
    NEED_IHC = "need_ihc"
    BORDER_UNCLEAR = "border_unclear"
    OUT_OF_FOCUS = "out_of_focus"
    NEED_SECOND_LOOK = "need_second_look"


verdicts = Table(
    "verdicts",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("value", String(10), nullable=False, info=OPERATIONAL),
    Column("style", String(10), nullable=False, info=OPERATIONAL),
    Column("answer", String(10), nullable=False, info=OPERATIONAL),
    Column("answer_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("reasons", ARRAY(String(20)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("reason_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("note", String(500), nullable=True, info=PHI),
    Column("reopened_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("reopened_note", String(500), nullable=True, info=PHI),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["reason_class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(
        ["answer_class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        name="fk_verdicts_answer_class_id_project_id_project_classes",
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    one_of("value", VerdictValue),
    one_of("style", DecisionStyle),
    CheckConstraint(
        "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
        "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
        "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
        "(style = 'blind' AND answer IN ('class', 'unsure'))",
        name="answer_fits_style",
    ),
    CheckConstraint(
        "(answer = 'class') = (answer_class_id IS NOT NULL)", name="answer_names_class"
    ),
    CheckConstraint(
        "(value = 'agree' AND cardinality(reasons) = 0) OR "
        "(value = 'unsure' AND reasons <@ ARRAY['need_deeper_level', 'need_ihc', "
        "'border_unclear', 'out_of_focus', 'need_second_look']::varchar[]) OR "
        "(value = 'disagree' AND kind = 'region' AND reasons <@ ARRAY['not_class', "
        "'boundary_off', 'two_regions', 'artefact']::varchar[]) OR "
        "(value = 'disagree' AND kind = 'cell' AND reasons <@ ARRAY['not_a_cell', "
        "'wrong_class', 'boundary_off', 'artefact']::varchar[])",
        name="reasons_fit",
    ),
    CheckConstraint(
        "('wrong_class' = ANY(reasons)) = (reason_class_id IS NOT NULL)",
        name="wrong_class_names_class",
    ),
)


class Decision(StrEnum):
    KEEP_AI = "keep-ai"
    GO_WITH_REVIEWERS = "go-with-reviewers"


disagreement_decisions = Table(
    "disagreement_decisions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("decision", String(20), nullable=True, info=OPERATIONAL),
    Column("style", String(10), nullable=True, info=OPERATIONAL),
    Column("answer", String(10), nullable=True, info=OPERATIONAL),
    Column("answer_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("value", String(10), nullable=True, info=OPERATIONAL),
    Column("left_open", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column("edits_settled_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("note", String(500), nullable=True, info=PHI),
    Column(
        "decided_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    one_of("decision", Decision),
    ForeignKeyConstraint(
        ["answer_class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        name="fk_disagreement_decisions_answer_class_id_project_classes",
    ),
    CheckConstraint(
        "style IS NULL OR style IN ('certainty', 'agree', 'yes-no', 'blind')", name="style"
    ),
    CheckConstraint(
        "style IS NULL OR "
        "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
        "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
        "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
        "(style = 'blind' AND answer IN ('class', 'unsure'))",
        name="answer_fits_style",
    ),
    CheckConstraint("(style IS NULL) = (answer IS NULL)", name="style_with_answer"),
    CheckConstraint(
        "(answer = 'class') = (answer_class_id IS NOT NULL) "
        "AND (answer IS NOT NULL OR answer_class_id IS NULL)",
        name="answer_names_class",
    ),
    CheckConstraint("value IS NULL OR value IN ('agree', 'disagree', 'unsure')", name="value"),
    CheckConstraint(
        "NOT (left_open AND value IS NOT NULL) "
        "AND (left_open OR value IS NOT NULL OR edits_settled_at IS NOT NULL)",
        name="decided_or_left_open",
    ),
)

opinions = Table(
    "opinions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("form_version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("answers", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=PHI),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["project_id", "form_version"], ["opinion_forms.project_id", "opinion_forms.version"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
)


class AnnouncementKind(StrEnum):
    MODEL = "model"
    SLOWDOWN = "slowdown"
    CHANGE = "change"


announcements = Table(
    "announcements",
    metadata,
    *owned_ids(),
    Column("kind", String(10), nullable=False, info=OPERATIONAL),
    Column("text", String(280), nullable=False, info=OPERATIONAL),
    Column("ends_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    Index("ix_announcements_tenant_id_created_at", "tenant_id", "created_at"),
    one_of("kind", AnnouncementKind),
)


site_validations = Table(
    "site_validations",
    metadata,
    *owned_ids(),
    Column("model_name", String(80), nullable=False, info=OPERATIONAL),
    Column("model_version", String(40), nullable=False, info=OPERATIONAL),
    Column("specimen_type", String(80), nullable=False, info=OPERATIONAL),
    Column("threshold", Float[float](), nullable=False, info=OPERATIONAL),
    Column("true_positives", Integer, nullable=False, info=OPERATIONAL),
    Column("false_positives", Integer, nullable=False, info=OPERATIONAL),
    Column("true_negatives", Integer, nullable=False, info=OPERATIONAL),
    Column("false_negatives", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "announcement_id",
        Uuid[uuid.UUID](),
        ForeignKey("announcements.id"),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    Index("ix_site_validations_tenant_id_created_at", "tenant_id", "created_at"),
    CheckConstraint(
        "least(true_positives, false_positives, true_negatives, false_negatives) >= 0",
        name="counts",
    ),
    CheckConstraint("threshold >= 0 AND threshold <= 1", name="threshold"),
)


class TierTask(StrEnum):
    TUMOR = "tumor"
    OUTLINE = "outline"
    TYPER = "typer"


model_tiers = Table(
    "model_tiers",
    metadata,
    *owned_ids(),
    Column("task", String(10), nullable=False, info=OPERATIONAL),
    Column("tier", String(10), nullable=False, info=OPERATIONAL),
    Column("model_name", String(80), nullable=False, info=OPERATIONAL),
    Column("model_version", String(40), nullable=False, info=OPERATIONAL),
    Column(
        "set_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "task", "tier"),
    one_of("task", TierTask),
    one_of("tier", ModelTier),
)


rate_counters = Table(
    "rate_counters",
    metadata,
    Column("key", String(80), primary_key=True, info=PERSONAL),
    Column("window_start", DateTime(timezone=True), primary_key=True, info=OPERATIONAL),
    Column("count", Integer, nullable=False, info=OPERATIONAL),
    prefixes=["UNLOGGED"],
)

MIN_AUDIT_DAYS = 365

retention_policies = Table(
    "retention_policies",
    metadata,
    Column(
        "tenant_id", Uuid[uuid.UUID](), ForeignKey("tenants.id"), primary_key=True, info=OPERATIONAL
    ),
    Column("deleted_after_days", Integer, nullable=True, info=OPERATIONAL),
    Column("audit_after_days", Integer, nullable=True, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint("deleted_after_days >= 1", name="deleted_after_days"),
    CheckConstraint(f"audit_after_days >= {MIN_AUDIT_DAYS}", name="audit_after_days"),
)

legal_holds = Table(
    "legal_holds",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("reason", String(500), nullable=False, info=PERSONAL),
    Column(
        "placed_by_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL
    ),
    Column("released_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "released_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
)


class UploadStatus(StrEnum):
    OPEN = "open"
    COMPLETED = "completed"
    ABORTED = "aborted"
    EXPIRED = "expired"


MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_PARTS = 10_000

uploads = Table(
    "uploads",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "created_by_service_id",
        Uuid[uuid.UUID](),
        ForeignKey("service_accounts.id"),
        nullable=True,
        info=OPERATIONAL,
    ),
    Column("file_name", String(255), nullable=False, info=PHI),
    Column("size_bytes", BigInteger, nullable=False, info=OPERATIONAL),
    Column("last_modified_ms", BigInteger, nullable=True, info=OPERATIONAL),
    Column("object_key", String(512), nullable=False, unique=True, info=PHI),
    Column("storage_upload_id", String(1024), nullable=False, info=OPERATIONAL),
    Column("part_bytes", BigInteger, nullable=False, info=OPERATIONAL),
    Column("part_count", Integer, nullable=False, info=OPERATIONAL),
    Column("status", String(10), nullable=False, server_default="open", info=OPERATIONAL),
    Column("etag", String(80), nullable=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), ForeignKey("jobs.id"), nullable=True, info=OPERATIONAL),
    Column(
        "last_activity_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("closed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("kind", String(10), nullable=False, server_default="slide", info=OPERATIONAL),
    Column("result_format", String(20), nullable=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("slide_upload_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("pairing_rule", String(30), nullable=True, info=OPERATIONAL),
    Column("pairing_certainty", String(10), nullable=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("import_problems", JSONB, nullable=True, info=OPERATIONAL),
    Column("import_choices", JSONB, nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("id", "project_id"),
    UniqueConstraint("result_set_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
    ForeignKeyConstraint(
        ["slide_id", "project_id"], ["slides.id", "slides.project_id"], use_alter=True
    ),
    ForeignKeyConstraint(["slide_upload_id", "project_id"], ["uploads.id", "uploads.project_id"]),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"],
        ["result_sets.id", "result_sets.project_id"],
        use_alter=True,
    ),
    one_of("status", UploadStatus),
    one_of("kind", UploadKind),
    one_of("result_format", ResultFormat),
    one_of("pairing_rule", Rule),
    one_of("pairing_certainty", Certainty),
    CheckConstraint(
        "kind = 'result' OR (result_format IS NULL AND slide_id IS NULL "
        "AND slide_upload_id IS NULL AND pairing_rule IS NULL AND result_set_id IS NULL)",
        name="slide_fields",
    ),
    CheckConstraint("(pairing_rule IS NULL) = (pairing_certainty IS NULL)", name="pairing"),
    CheckConstraint(
        "pairing_rule IS NULL OR slide_id IS NOT NULL OR slide_upload_id IS NOT NULL",
        name="paired_with",
    ),
    CheckConstraint("result_set_id IS NULL OR slide_id IS NOT NULL", name="imported_on_slide"),
    CheckConstraint("slide_upload_id IS NULL OR slide_upload_id <> id", name="not_itself"),
    CheckConstraint("size_bytes > 0", name="size_bytes"),
    CheckConstraint(f"part_bytes >= {MIN_UPLOAD_PART_BYTES}", name="part_bytes"),
    CheckConstraint(f"part_count BETWEEN 1 AND {MAX_UPLOAD_PARTS}", name="part_count"),
    CheckConstraint("(status = 'open') = (closed_at IS NULL)", name="closed"),
    CheckConstraint(
        "(created_by_user_id IS NULL) <> (created_by_service_id IS NULL)", name="created_by"
    ),
    CheckConstraint(
        "(job_id IS NULL OR status = 'completed') "
        "AND (kind = 'result' OR status <> 'completed' OR job_id IS NOT NULL)",
        name="completed_job",
    ),
    Index(
        "ix_uploads_slide_upload_id",
        "slide_upload_id",
        postgresql_where=text("slide_upload_id IS NOT NULL"),
    ),
    Index(
        "ix_uploads_open_by_file",
        "project_id",
        "file_name",
        "size_bytes",
        postgresql_where=text("status = 'open'"),
    ),
    Index(
        "ix_uploads_open_by_activity",
        "last_activity_at",
        postgresql_where=text("status = 'open'"),
    ),
)


class AnchorKind(StrEnum):
    OBJECT = "object"
    ROI = "roi"
    POINT = "point"
    SHAPE = "shape"


threads = Table(
    "threads",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("title", String(120), nullable=False, info=PHI),
    Column("anchor_kind", String(10), nullable=False, info=OPERATIONAL),
    Column("object_id", String(30), nullable=True, info=OPERATIONAL),
    Column("geometry", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("offset_x", Float[float](), nullable=True, info=OPERATIONAL),
    Column("offset_y", Float[float](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=False,
        info=PERSONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("resolved_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "resolved_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    Index("ix_threads_task_id_slide_id", "task_id", "slide_id"),
    one_of("anchor_kind", AnchorKind),
    CheckConstraint(
        "(anchor_kind IN ('object', 'roi')) = (object_id IS NOT NULL)", name="object_anchor"
    ),
    CheckConstraint(
        "(anchor_kind IN ('point', 'shape')) = (geometry IS NOT NULL)", name="geometry_anchor"
    ),
    CheckConstraint("(offset_x IS NULL) = (offset_y IS NULL)", name="offset"),
    CheckConstraint("(resolved_at IS NULL) = (resolved_by_user_id IS NULL)", name="resolved"),
)

thread_messages = Table(
    "thread_messages",
    metadata,
    *owned_ids(),
    Column(
        "thread_id",
        Uuid[uuid.UUID](),
        ForeignKey("threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column("body", String(4000), nullable=False, info=PHI),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)
