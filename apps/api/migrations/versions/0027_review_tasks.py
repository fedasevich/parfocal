import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("review_tasks", "review_task_slides", "review_assignments")


def upgrade() -> None:
    op.create_table(
        "review_tasks",
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
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("split", sa.String(10), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("scope_count", sa.Integer, nullable=True),
        sa.Column("scope_seed", sa.BigInteger, nullable=True),
        sa.Column("scope_score", sa.SmallInteger, nullable=True),
        sa.Column("opinion_form_version", sa.SmallInteger, nullable=False),
        sa.Column("blinded", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column(
            "ai_hidden_first_read", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column("start_mode", sa.String(10), nullable=False),
        sa.Column("due_on", sa.Date, nullable=True),
        sa.Column(
            "reminder_days",
            postgresql.ARRAY(sa.SmallInteger),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("project_id", "number"),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["project_id", "opinion_form_version"],
            ["opinion_forms.project_id", "opinion_forms.version"],
        ),
        sa.CheckConstraint("split IN ('everyone', 'even', 'chosen')", name="split"),
        sa.CheckConstraint(
            "scope IN ('all-regions', 'random-cells', 'cells-below-score', 'inside-rois', "
            "'unsure-zones')",
            name="scope",
        ),
        sa.CheckConstraint("start_mode IN ('guided', 'viewer')", name="start_mode"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint(
            "(scope = 'random-cells') = (scope_count IS NOT NULL AND scope_seed IS NOT NULL)",
            name="random_cells",
        ),
        sa.CheckConstraint(
            "scope_count IS NULL OR scope_count BETWEEN 1 AND 10000", name="scope_count"
        ),
        sa.CheckConstraint(
            "(scope = 'cells-below-score') = (scope_score IS NOT NULL)", name="cells_below_score"
        ),
        sa.CheckConstraint(
            "scope_score IS NULL OR scope_score BETWEEN 0 AND 255", name="scope_score"
        ),
        sa.CheckConstraint("cardinality(reminder_days) <= 3", name="reminders"),
    )
    op.create_table(
        "review_task_slides",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True, index=True),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("result_set_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.UniqueConstraint("task_id", "position"),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"], ["review_tasks.id", "review_tasks.project_id"]
        ),
        sa.ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
        sa.ForeignKeyConstraint(
            ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
        ),
    )
    op.create_table(
        "review_assignments",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), primary_key=True, index=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
    )
    for table in TABLES:
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    for statement in track_updated_at("review_tasks"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("review_assignments")
    op.drop_table("review_task_slides")
    op.execute(untrack_updated_at("review_tasks")[0])
    op.drop_table("review_tasks")
