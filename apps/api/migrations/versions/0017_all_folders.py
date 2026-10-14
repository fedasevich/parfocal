from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("all_folders", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint("all_folders", "memberships", "NOT all_folders OR role = 'lead'")


def downgrade() -> None:
    op.drop_constraint("all_folders", "memberships", type_="check")
    op.drop_column("memberships", "all_folders")
