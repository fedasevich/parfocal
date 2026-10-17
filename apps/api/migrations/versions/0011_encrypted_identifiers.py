import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.db import PLATFORM_OPERATOR
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0011"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
        "tenant_keys",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("purpose", sa.String(10), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("master_id", sa.String(40), nullable=False),
        sa.Column("wrapped_key", sa.LargeBinary, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("tenant_id", "purpose", "version"),
        sa.CheckConstraint("purpose IN ('data', 'index')", name="purpose"),
        sa.CheckConstraint("version BETWEEN 1 AND 65535", name="version"),
    )
    op.create_table(
        "patients",
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
        sa.Column("name_ciphertext", sa.LargeBinary, nullable=False),
        sa.Column("name_tokens", postgresql.ARRAY(sa.LargeBinary), nullable=False),
        sa.Column("mrn_ciphertext", sa.LargeBinary, nullable=True),
        sa.Column("mrn_index", sa.LargeBinary, nullable=True),
        sa.Column("birth_date_ciphertext", sa.LargeBinary, nullable=True),
        sa.Column("birth_date_index", sa.LargeBinary, nullable=True),
        *timestamps(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", "mrn_index"),
    )
    op.create_index("ix_patients_name_tokens", "patients", ["name_tokens"], postgresql_using="gin")
    op.create_index("ix_patients_birth_date_index", "patients", ["tenant_id", "birth_date_index"])
    for statement in [
        *enable_tenant_isolation("tenant_keys"),
        f"CREATE POLICY platform_keys ON tenant_keys FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
        f"CREATE POLICY platform_changes_keys ON tenant_keys AS RESTRICTIVE FOR UPDATE "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
        f"CREATE POLICY platform_shreds_keys ON tenant_keys AS RESTRICTIVE FOR DELETE "
        f"USING ({PLATFORM_OPERATOR})",
        *enable_tenant_isolation("patients"),
        *track_updated_at("patients"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("patients")[0])
    op.drop_table("patients")
    op.drop_table("tenant_keys")
