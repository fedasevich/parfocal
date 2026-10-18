import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_tasks", sa.Column("signed_off_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "review_tasks",
        sa.Column(
            "signed_off_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("review_tasks", "signed_off_by_user_id")
    op.drop_column("review_tasks", "signed_off_at")
