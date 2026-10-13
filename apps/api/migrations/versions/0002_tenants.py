import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import CURRENT_TENANT
from parfocal_common.schema_sql import (
    disable_platform_management,
    enable_platform_management,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SLUG_CHECK = "slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'"
ORGANISATION_OF_CURRENT_TENANT = (
    f"id IN (SELECT organisation_id FROM tenants WHERE id = {CURRENT_TENANT})"
)


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
        "organisations",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("slug", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        *timestamps(),
        sa.CheckConstraint(SLUG_CHECK, name="slug"),
    )
    op.create_table(
        "tenants",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "organisation_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("organisations.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("slug", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("region", sa.String(10), nullable=False),
        sa.Column("plan", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
        sa.CheckConstraint(SLUG_CHECK, name="slug"),
        sa.CheckConstraint("kind IN ('diagnostic', 'research', 'second-opinion')", name="kind"),
        sa.CheckConstraint("region IN ('eu', 'us')", name="region"),
        sa.CheckConstraint("plan IN ('pilot')", name="plan"),
        sa.CheckConstraint("status IN ('active', 'suspended')", name="status"),
        sa.CheckConstraint(
            "(status = 'suspended') = (suspended_at IS NOT NULL)", name="suspended_at"
        ),
    )
    for statement in (
        enable_platform_management("tenants", f"id = {CURRENT_TENANT}")
        + enable_platform_management("organisations", ORGANISATION_OF_CURRENT_TENANT)
        + track_updated_at("tenants")
        + track_updated_at("organisations")
    ):
        op.execute(statement)


def downgrade() -> None:
    for statement in (
        untrack_updated_at("organisations")
        + untrack_updated_at("tenants")
        + disable_platform_management("organisations")
        + disable_platform_management("tenants")
    ):
        op.execute(statement)
    op.drop_table("tenants")
    op.drop_table("organisations")
