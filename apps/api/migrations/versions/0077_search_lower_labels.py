from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0077"
down_revision: str | None = "0076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOWERED = (("projects", "name"), ("cases", "label"), ("slides", "label"))


def upgrade() -> None:
    for table, column in LOWERED:
        op.add_column(
            table,
            sa.Column(
                f"{column}_lower",
                sa.Text(),
                sa.Computed(f"lower({column})", persisted=True),
                nullable=False,
            ),
        )


def downgrade() -> None:
    for table, column in reversed(LOWERED):
        op.drop_column(table, f"{column}_lower")
