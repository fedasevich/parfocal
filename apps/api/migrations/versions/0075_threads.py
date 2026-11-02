import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def owned_columns() -> list[sa.Column[uuid.UUID]]:
    return [
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
    ]


def created_at() -> sa.Column[datetime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "threads",
        *owned_columns(),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("anchor_kind", sa.String(10), nullable=False),
        sa.Column("object_id", sa.String(30), nullable=True),
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
        sa.Column("offset_x", sa.Float(), nullable=True),
        sa.Column("offset_y", sa.Float(), nullable=True),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False
        ),
        created_at(),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
        ),
        sa.CheckConstraint(
            "anchor_kind IN ('object', 'roi', 'point', 'shape')", name="anchor_kind"
        ),
        sa.CheckConstraint(
            "(anchor_kind IN ('object', 'roi')) = (object_id IS NOT NULL)", name="object_anchor"
        ),
        sa.CheckConstraint(
            "(anchor_kind IN ('point', 'shape')) = (geometry IS NOT NULL)", name="geometry_anchor"
        ),
        sa.CheckConstraint("(offset_x IS NULL) = (offset_y IS NULL)", name="offset"),
        sa.CheckConstraint(
            "(resolved_at IS NULL) = (resolved_by_user_id IS NULL)", name="resolved"
        ),
    )
    op.create_index("ix_threads_task_id_slide_id", "threads", ["task_id", "slide_id"])
    op.create_table(
        "thread_messages",
        *owned_columns(),
        sa.Column(
            "thread_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("body", sa.String(4000), nullable=False),
        created_at(),
    )
    for table in ("threads", "thread_messages"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)


def downgrade() -> None:
    op.drop_table("thread_messages")
    op.drop_table("threads")
