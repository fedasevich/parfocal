from collections.abc import Sequence

from alembic import op

revision: str = "0140"
down_revision: str | None = "0139"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE slides ADD COLUMN layer_groups jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE slides DROP COLUMN layer_groups")
