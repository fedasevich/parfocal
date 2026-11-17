from collections.abc import Sequence

from alembic import op

revision: str = "0138"
down_revision: str | None = "0137"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE memberships ADD COLUMN deactivates_on date")
    op.execute("ALTER TABLE memberships ADD COLUMN deactivated_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE memberships DROP COLUMN deactivated_at")
    op.execute("ALTER TABLE memberships DROP COLUMN deactivates_on")
