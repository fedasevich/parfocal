import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0072"
down_revision: str | None = "0071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "job_units",
        sa.Column("seq", sa.BigInteger, sa.Identity(always=True), nullable=False),
    )
    op.add_column("job_units", sa.Column("result", postgresql.JSONB, nullable=True))
    op.create_index("ix_job_units_job_id_seq", "job_units", ["job_id", "seq"])
    op.create_table(
        "stage_throughput",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("ordinal", sa.SmallInteger, primary_key=True),
        sa.Column("run", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("stage", sa.String(40), nullable=False),
        sa.Column("model", sa.String(80), nullable=True),
        sa.Column("model_version", sa.String(40), nullable=True),
        sa.Column("tier", sa.String(20), nullable=True),
        sa.Column("machine", sa.String(80), nullable=False),
        sa.Column("worker", sa.String(80), nullable=False),
        sa.Column("units", sa.Integer, nullable=False),
        sa.Column("seconds", sa.Float[float](), nullable=False),
        sa.Column(
            "finished_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["job_id", "ordinal"],
            ["job_steps.job_id", "job_steps.ordinal"],
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_stage_throughput_tenant_id", "stage_throughput", ["tenant_id"])
    op.create_index(
        "ix_stage_throughput_model", "stage_throughput", ["model", "model_version", "stage"]
    )
    for statement in enable_tenant_isolation("stage_throughput"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("stage_throughput")
    op.drop_index("ix_job_units_job_id_seq", table_name="job_units")
    op.drop_column("job_units", "result")
    op.drop_column("job_units", "seq")
