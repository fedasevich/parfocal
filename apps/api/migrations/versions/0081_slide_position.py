from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("slides", sa.Column("position", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("slides", "position")
