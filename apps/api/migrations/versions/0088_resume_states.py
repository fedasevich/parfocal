import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0088"
down_revision: str | None = "0087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "resume_states",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column(
            "task_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("review_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "slide_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("slides.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("object_id", sa.String(40), nullable=True),
        sa.Column("camera", JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("tenant_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("mode IN ('guided', 'viewer')", name="mode"),
    )
    for statement in [
        *enable_tenant_isolation("resume_states"),
        *track_updated_at("resume_states"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("resume_states")[0])
    op.drop_table("resume_states")
