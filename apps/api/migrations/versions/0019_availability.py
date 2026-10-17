from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AVAILABILITY_CHECK = (
    "availability = 'away'"
    " OR (availability = 'available' AND available_again_at IS NULL AND availability_note IS NULL)"
)


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("availability", sa.String(10), nullable=False, server_default="available"),
    )
    op.add_column(
        "memberships",
        sa.Column("available_again_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("memberships", sa.Column("availability_note", sa.String(200), nullable=True))
    op.create_check_constraint("availability", "memberships", AVAILABILITY_CHECK)


def downgrade() -> None:
    op.drop_constraint("availability", "memberships", type_="check")
    op.drop_column("memberships", "availability_note")
    op.drop_column("memberships", "available_again_at")
    op.drop_column("memberships", "availability")
