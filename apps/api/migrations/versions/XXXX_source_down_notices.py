from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0133"
down_revision: str | None = "0132"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "import_sources"
COLUMN = "down_notified_at"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
