from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0150"
down_revision: str | None = "0148"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "final_layers"
COLUMN = "classes"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column(COLUMN, JSONB()))


def downgrade() -> None:
    op.drop_column(TABLE, COLUMN)
