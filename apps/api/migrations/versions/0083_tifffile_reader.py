from collections.abc import Sequence

from alembic import op

revision: str = "0083"
down_revision: str | None = "0082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE slides SET reader = 'tifffile' WHERE reader = 'tiffslide'")


def downgrade() -> None:
    op.execute("UPDATE slides SET reader = 'tiffslide' WHERE reader = 'tifffile'")
