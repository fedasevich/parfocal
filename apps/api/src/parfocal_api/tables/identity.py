import uuid
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
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

from parfocal_api.tables.base import (
    ADMIN_RIGHTS_CHECK,
    AVAILABILITY_CHECK,
    DEFAULT_EMERGENCY_HOURS,
    LOGO_COLOUR_PATTERN,
    LOGO_PATTERN,
    MEMBER_ROLE_CHECK,
    SLUG_PATTERN,
    Availability,
    JoinPolicy,
    Plan,
    Region,
    TenantKind,
    TenantStatus,
    admin_rights_column,
    one_of,
    timestamps,
)
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, SECRET
from parfocal_common.db import metadata, tenant_foreign_key, tenant_unique

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
    Column("email_domain", String(253), nullable=True, index=True, info=OPERATIONAL),
    Column(
        "join_policy",
        String(10),
        nullable=False,
        server_default=JoinPolicy.JOIN.value,
        info=OPERATIONAL,
    ),
    Column("logo", String(3), nullable=True, info=OPERATIONAL),
    Column("logo_colour", String(7), nullable=True, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug"),
    one_of("join_policy", JoinPolicy),
    CheckConstraint(f"logo ~ '{LOGO_PATTERN}'", name="logo"),
    CheckConstraint(f"logo_colour ~ '{LOGO_COLOUR_PATTERN}'", name="logo_colour"),
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
    Column("specialties", ARRAY(String(60)), nullable=False, server_default="{}", info=PERSONAL),
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
    tenant_unique(),
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
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("service_account_id", "service_accounts"),
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
        nullable=True,
        index=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("task_id", "review_tasks"),
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

sso_connections = Table(
    "sso_connections",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("idp_organisation_id", String(64), nullable=False, unique=True, info=OPERATIONAL),
    Column("idp_id", String(64), nullable=False, info=OPERATIONAL),
    Column("email_domains", ARRAY(String(253)), nullable=False, info=OPERATIONAL),
    Column("default_role", String(30), nullable=True, info=OPERATIONAL),
    Column(
        "group_roles",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
        info=OPERATIONAL,
    ),
    *timestamps(),
    CheckConstraint(
        "default_role IS NULL OR default_role IN ('researcher', 'reviewer')", name="default_role"
    ),
    CheckConstraint("cardinality(email_domains) > 0", name="email_domains"),
)
