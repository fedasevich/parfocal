import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "site_validations",
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
        sa.Column("model_name", sa.String(80), nullable=False),
        sa.Column("model_version", sa.String(40), nullable=False),
        sa.Column("specimen_type", sa.String(80), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("true_positives", sa.Integer(), nullable=False),
        sa.Column("false_positives", sa.Integer(), nullable=False),
        sa.Column("true_negatives", sa.Integer(), nullable=False),
        sa.Column("false_negatives", sa.Integer(), nullable=False),
        sa.Column(
            "announcement_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("announcements.id"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "least(true_positives, false_positives, true_negatives, false_negatives) >= 0",
            name="counts",
        ),
        sa.CheckConstraint("threshold >= 0 AND threshold <= 1", name="threshold"),
    )
    op.create_index(
        "ix_site_validations_tenant_id_created_at",
        "site_validations",
        ["tenant_id", "created_at"],
    )
    for statement in [
        *enable_tenant_isolation("site_validations"),
        *track_updated_at("site_validations"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("site_validations")[0])
    op.drop_table("site_validations")
