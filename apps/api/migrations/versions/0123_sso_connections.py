from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.db import AUTH_SERVICE
from parfocal_common.schema_sql import (
    disable_platform_management,
    disable_tenant_isolation,
    enable_platform_management,
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0123"
down_revision: str | None = "0122"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "sso_connections"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("idp_organisation_id", sa.String(64), nullable=False, unique=True),
        sa.Column("idp_id", sa.String(64), nullable=False),
        sa.Column("email_domains", postgresql.ARRAY(sa.String(253)), nullable=False),
        sa.Column("default_role", sa.String(30), nullable=True),
        sa.Column(
            "group_roles",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "default_role IS NULL OR default_role IN ('researcher', 'reviewer')",
            name="default_role",
        ),
        sa.CheckConstraint("cardinality(email_domains) > 0", name="email_domains"),
    )
    for statement in (
        enable_tenant_isolation(TABLE)
        + enable_platform_management(TABLE, AUTH_SERVICE)
        + track_updated_at(TABLE)
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in (
        untrack_updated_at(TABLE)
        + disable_platform_management(TABLE)
        + disable_tenant_isolation(TABLE)
    ):
        op.execute(statement)
    op.drop_table(TABLE)
