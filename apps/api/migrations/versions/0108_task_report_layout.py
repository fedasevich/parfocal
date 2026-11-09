from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0108"
down_revision: str | None = "0107"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("report_layout", postgresql.JSONB(none_as_null=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_tasks", "report_layout")
