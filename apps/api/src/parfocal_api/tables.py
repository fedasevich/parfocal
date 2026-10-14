import uuid
from datetime import datetime
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
    UniqueConstraint,
    Uuid,
    func,
    text,
)

from parfocal_common.db import metadata

SLUG_PATTERN = "^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"


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
        Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
        Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    ]


organisations = Table(
    "organisations",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("slug", String(40), nullable=False, unique=True),
    Column("name", String(200), nullable=False),
    *timestamps(),
    CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug"),
)

tenants = Table(
    "tenants",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column(
        "organisation_id",
        Uuid[uuid.UUID](),
        ForeignKey("organisations.id"),
        nullable=False,
        index=True,
    ),
    Column("slug", String(40), nullable=False, unique=True),
    Column("name", String(200), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("region", String(10), nullable=False),
    Column("plan", String(20), nullable=False),
    Column("status", String(20), nullable=False, server_default=TenantStatus.ACTIVE.value),
    Column("suspended_at", DateTime(timezone=True), nullable=True),
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
    Column("subject", String(200), primary_key=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

auth_logins = Table(
    "auth_logins",
    metadata,
    Column("state_hash", LargeBinary, primary_key=True),
    Column("binding_hash", LargeBinary, nullable=False),
    Column("code_verifier", String(200), nullable=False),
    Column("nonce", String(200), nullable=False),
    Column("return_to", String(2000), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True),
)

sessions = Table(
    "sessions",
    metadata,
    Column("id_hash", LargeBinary, primary_key=True),
    Column("subject", String(200), nullable=False, index=True),
    Column("tokens", LargeBinary, nullable=False),
    Column("access_expires_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True),
    Column("last_seen_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column(
        "active_tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
    ),
)

AVATAR_COLOURS = 12

users = Table(
    "users",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("subject", String(200), nullable=False, unique=True),
    Column("email", String(320), nullable=True),
    Column("display_name", String(200), nullable=False),
    Column("initials", String(3), nullable=False),
    Column("avatar_colour", SmallInteger, nullable=False),
    Column("title", String(40), nullable=True),
    Column(
        "last_tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
    ),
    *timestamps(),
    CheckConstraint("initials ~ '^[A-Z]{1,3}$'", name="initials"),
    CheckConstraint("avatar_colour BETWEEN 0 AND 11", name="avatar_colour"),
)

memberships = Table(
    "memberships",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("tenant_id", Uuid[uuid.UUID](), ForeignKey("tenants.id"), nullable=False, index=True),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, index=True),
    Column("role", String(30), nullable=False),
    *timestamps(),
    UniqueConstraint("tenant_id", "user_id"),
    CheckConstraint(MEMBER_ROLE_CHECK, name="role"),
)


class ActorKind(StrEnum):
    USER = "user"
    MEMBER = "member"
    GUEST = "guest"
    OPERATOR = "operator"
    SYSTEM = "system"


audit_people = Table(
    "audit_people",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("subject", String(200), nullable=False, unique=True),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("tenant_id", Uuid[uuid.UUID](), ForeignKey("tenants.id"), nullable=True),
    Column("seq", BigInteger, nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("actor_kind", String(20), nullable=False),
    Column("actor_id", Uuid[uuid.UUID](), nullable=True),
    Column("action", String(60), nullable=False),
    Column("target_type", String(40), nullable=False),
    Column("target_id", Uuid[uuid.UUID](), nullable=True),
    Column("details", Text, nullable=False, server_default="{}"),
    Column("prev_hash", LargeBinary, nullable=False),
    Column("hash", LargeBinary, nullable=False),
    UniqueConstraint("tenant_id", "seq", postgresql_nulls_not_distinct=True),
    Index(
        "ix_audit_events_tenant_id_target_type_target_id", "tenant_id", "target_type", "target_id"
    ),
    one_of("actor_kind", ActorKind),
)
