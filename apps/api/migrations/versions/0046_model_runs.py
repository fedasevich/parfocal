import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = "status IN ('queued', 'running', 'done', 'failed')"
NEW_STATUSES = (
    "status IN ('queued', 'running', 'paused', 'cancelling', 'cancelled', 'done', 'failed')"
)


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def upgrade() -> None:
    op.drop_constraint("status", "jobs", type_="check")
    op.create_check_constraint("status", "jobs", NEW_STATUSES)
    op.add_column("jobs", sa.Column("pause_reason", sa.String(60), nullable=True))
    op.create_check_constraint(
        "pause_reason", "jobs", "(status = 'paused') = (pause_reason IS NOT NULL)"
    )
    op.add_column("job_steps", sa.Column("units_total", sa.Integer, nullable=True))
    op.create_check_constraint(
        "units_total", "job_steps", "units_total IS NULL OR units_total >= 0"
    )
    op.create_table(
        "model_runs",
        sa.Column("job_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("batch_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("scope_kind", sa.String(10), nullable=False),
        sa.Column("scope", postgresql.JSONB, nullable=True),
        sa.Column("detector", sa.String(80), nullable=False),
        sa.Column("detector_version", sa.String(40), nullable=False),
        sa.Column("typer", sa.String(80), nullable=True),
        sa.Column("typer_version", sa.String(40), nullable=True),
        sa.Column("test_time_views", sa.SmallInteger, nullable=False),
        sa.Column("ordering", sa.String(12), nullable=False),
        sa.Column(
            "started_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"]),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"], ["review_tasks.id", "review_tasks.project_id"]
        ),
        sa.CheckConstraint("scope_kind IN ('view', 'selection', 'slide')", name="scope_kind"),
        sa.CheckConstraint("ordering IN ('raster', 'tumor-first')", name="ordering"),
        sa.CheckConstraint("test_time_views IN (1, 8)", name="test_time_views"),
        sa.CheckConstraint("(scope_kind = 'slide') = (scope IS NULL)", name="scope"),
        sa.CheckConstraint("(typer IS NULL) = (typer_version IS NULL)", name="typer_version"),
        sa.CheckConstraint("test_time_views = 1 OR typer IS NOT NULL", name="views_need_typer"),
    )
    op.create_index("ix_model_runs_tenant_id", "model_runs", ["tenant_id"])
    op.create_index("ix_model_runs_slide_id", "model_runs", ["slide_id"])
    op.create_index("ix_model_runs_task_id", "model_runs", ["task_id"])
    op.create_index("ix_model_runs_batch_id", "model_runs", ["batch_id"])
    op.create_index(
        "ix_model_runs_project_id_created_at", "model_runs", ["project_id", "created_at"]
    )
    for statement in enable_tenant_isolation("model_runs"):
        op.execute(statement)
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON model_runs FROM {app_role()}")


def downgrade() -> None:
    op.drop_table("model_runs")
    op.drop_constraint("units_total", "job_steps", type_="check")
    op.drop_column("job_steps", "units_total")
    op.drop_constraint("pause_reason", "jobs", type_="check")
    op.drop_column("jobs", "pause_reason")
    op.drop_constraint("status", "jobs", type_="check")
    op.create_check_constraint("status", "jobs", OLD_STATUSES)
