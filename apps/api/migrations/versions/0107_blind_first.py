from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0107"
down_revision: str | None = "0106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("blind_first", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_check_constraint(
        "blind_first", "review_tasks", "kind = 'annotate' OR NOT blind_first"
    )


def downgrade() -> None:
    op.drop_constraint("blind_first", "review_tasks", type_="check")
    op.drop_column("review_tasks", "blind_first")
