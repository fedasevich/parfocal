from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_CHECK = "role IN ('consultant', 'resident', 'lead', 'lab', 'admin')"


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("role", sa.String(30), nullable=False, server_default="consultant"),
    )
    op.alter_column("memberships", "role", server_default=None)
    op.create_check_constraint("role", "memberships", ROLE_CHECK)


def downgrade() -> None:
    op.drop_constraint("role", "memberships", type_="check")
    op.drop_column("memberships", "role")
