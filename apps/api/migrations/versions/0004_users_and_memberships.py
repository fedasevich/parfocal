import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import AUTH_SERVICE, CURRENT_TENANT, CURRENT_USER, PLATFORM_OPERATOR
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MEMBERS_OF_CURRENT_TENANT = f"SELECT user_id FROM memberships WHERE tenant_id = {CURRENT_TENANT}"
TENANTS_OF_CURRENT_USER = f"SELECT tenant_id FROM memberships WHERE user_id = {CURRENT_USER}"


def timestamps() -> list[sa.Column[datetime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("subject", sa.String(200), nullable=False, unique=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("initials", sa.String(3), nullable=False),
        sa.Column("avatar_colour", sa.SmallInteger, nullable=False),
        sa.Column("title", sa.String(40), nullable=True),
        sa.Column(
            "last_tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *timestamps(),
        sa.CheckConstraint("initials ~ '^[A-Z]{1,3}$'", name="initials"),
        sa.CheckConstraint("avatar_colour BETWEEN 0 AND 11", name="avatar_colour"),
    )
    op.create_table(
        "memberships",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False, index=True
        ),
        *timestamps(),
        sa.UniqueConstraint("tenant_id", "user_id"),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "active_tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    reader = f"{PLATFORM_OPERATOR} OR {AUTH_SERVICE}"
    for statement in [
        *enable_tenant_isolation("memberships"),
        f"CREATE POLICY own_memberships ON memberships FOR SELECT USING (user_id = {CURRENT_USER})",
        f"CREATE POLICY service_read ON memberships FOR SELECT USING ({reader})",
        f"CREATE POLICY platform_write ON memberships FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
        "ALTER TABLE users ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE users FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY users_read ON users FOR SELECT USING ({reader} "
        f"OR id = {CURRENT_USER} OR id IN ({MEMBERS_OF_CURRENT_TENANT}))",
        f"CREATE POLICY users_write ON users FOR ALL USING ({reader} OR id = {CURRENT_USER}) "
        f"WITH CHECK ({reader} OR id = {CURRENT_USER})",
        "DROP POLICY platform_read ON tenants",
        f"CREATE POLICY platform_read ON tenants FOR SELECT USING ({PLATFORM_OPERATOR} "
        f"OR id = {CURRENT_TENANT} OR id IN ({TENANTS_OF_CURRENT_USER}))",
        "DROP POLICY platform_read ON organisations",
        f"CREATE POLICY platform_read ON organisations FOR SELECT USING ({PLATFORM_OPERATOR} "
        "OR id IN (SELECT organisation_id FROM tenants))",
        *track_updated_at("users"),
        *track_updated_at("memberships"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    for statement in [
        *untrack_updated_at("memberships"),
        *untrack_updated_at("users"),
        "DROP POLICY users_read ON users",
        "DROP POLICY users_write ON users",
        "DROP POLICY platform_read ON organisations",
        f"CREATE POLICY platform_read ON organisations FOR SELECT USING ({PLATFORM_OPERATOR} "
        f"OR id IN (SELECT organisation_id FROM tenants WHERE id = {CURRENT_TENANT}))",
        "DROP POLICY platform_read ON tenants",
        f"CREATE POLICY platform_read ON tenants FOR SELECT USING ({PLATFORM_OPERATOR} "
        f"OR id = {CURRENT_TENANT})",
    ]:
        op.execute(statement)
    op.drop_column("sessions", "active_tenant_id")
    op.drop_table("memberships")
    op.drop_table("users")
