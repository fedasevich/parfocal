import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0079"
down_revision: str | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "invitations",
        sa.Column("task_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("review_tasks.id"), nullable=True),
    )
    op.create_index("ix_invitations_task_id", "invitations", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_invitations_task_id", "invitations")
    op.drop_column("invitations", "task_id")
