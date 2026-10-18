import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.db import PLATFORM_OPERATOR
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jobs",
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
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),
        sa.Column("input", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("claimed_by", sa.String(80), nullable=True),
        sa.Column("claims", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(60), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="status"),
    )
    op.create_index(
        "ix_jobs_claimable",
        "jobs",
        ["created_at"],
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.create_table(
        "job_steps",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("ordinal", sa.SmallInteger, nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("runs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("job_id", "ordinal"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.CheckConstraint("status IN ('pending', 'running', 'done', 'failed')", name="status"),
    )
    op.create_table(
        "job_units",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("ordinal", sa.SmallInteger, nullable=False),
        sa.Column("unit", sa.Integer, nullable=False),
        sa.Column("worker", sa.String(80), nullable=False),
        sa.Column(
            "done_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("job_id", "ordinal", "unit"),
        sa.ForeignKeyConstraint(
            ["job_id", "ordinal"],
            ["job_steps.job_id", "job_steps.ordinal"],
            ondelete="CASCADE",
        ),
    )
    for table in ("jobs", "job_steps", "job_units"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    op.execute(
        f"CREATE POLICY platform_claims ON jobs FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})"
    )


def downgrade() -> None:
    op.drop_table("job_units")
    op.drop_table("job_steps")
    op.drop_table("jobs")
