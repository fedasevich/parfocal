import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0076"
down_revision: str | None = "0075"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model_tiers",
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
        sa.Column("task", sa.String(10), nullable=False),
        sa.Column("tier", sa.String(10), nullable=False),
        sa.Column("model_name", sa.String(80), nullable=False),
        sa.Column("model_version", sa.String(40), nullable=False),
        sa.Column("set_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "task", "tier"),
        sa.CheckConstraint("task IN ('tumor', 'outline', 'typer')", name="task"),
        sa.CheckConstraint("tier IN ('best', 'good', 'fast')", name="tier"),
    )
    for statement in [
        *enable_tenant_isolation("model_tiers"),
        *track_updated_at("model_tiers"),
    ]:
        op.execute(statement)
    op.add_column("model_runs", sa.Column("tier", sa.String(10), nullable=True))
    op.create_check_constraint("tier", "model_runs", "tier IN ('best', 'good', 'fast')")


def downgrade() -> None:
    op.drop_constraint("tier", "model_runs", type_="check")
    op.drop_column("model_runs", "tier")
    op.execute(untrack_updated_at("model_tiers")[0])
    op.drop_table("model_tiers")
