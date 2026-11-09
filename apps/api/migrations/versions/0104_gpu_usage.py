import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0104"
down_revision: str | None = "0103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    op.create_table(
        "gpu_usage",
        sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("model", sa.String(80), nullable=True),
        sa.Column("model_version", sa.String(40), nullable=True),
        sa.Column("tier", sa.String(20), nullable=True),
        sa.Column("gpu", sa.String(40), nullable=True),
        sa.Column("worker", sa.String(80), nullable=False),
        sa.Column("seconds", sa.Float[float](), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_gpu_usage_tenant_id", "gpu_usage", ["tenant_id"])
    op.create_index("ix_gpu_usage_job_id", "gpu_usage", ["job_id"])
    op.create_index("ix_gpu_usage_tenant_id_recorded_at", "gpu_usage", ["tenant_id", "recorded_at"])
    for statement in enable_tenant_isolation("gpu_usage"):
        op.execute(statement)
    op.execute(f"REVOKE UPDATE, TRUNCATE ON gpu_usage FROM {app_role()}")


def downgrade() -> None:
    op.drop_table("gpu_usage")
