from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("email_digest", sa.String(10), nullable=False, server_default="off")
    )
    op.add_column("users", sa.Column("quiet_from", sa.Time, nullable=True))
    op.add_column("users", sa.Column("quiet_until", sa.Time, nullable=True))
    op.add_column(
        "users", sa.Column("time_zone", sa.String(60), nullable=False, server_default="UTC")
    )
    op.create_check_constraint(
        "email_digest", "users", "email_digest IN ('off', 'hourly', 'daily')"
    )
    op.create_check_constraint(
        "quiet_hours", "users", "(quiet_from IS NULL) = (quiet_until IS NULL)"
    )


def downgrade() -> None:
    op.drop_constraint("quiet_hours", "users", type_="check")
    op.drop_constraint("email_digest", "users", type_="check")
    for column in ("time_zone", "quiet_until", "quiet_from", "email_digest"):
        op.drop_column("users", column)
