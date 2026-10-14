from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cases",
        sa.Column(
            "state_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column("cases", sa.Column("cancelled_from", sa.String(30), nullable=True))
    op.add_column("cases", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "cancelled",
        "cases",
        "(state = 'cancelled') = (cancelled_from IS NOT NULL) "
        "AND (state = 'cancelled') = (cancelled_at IS NOT NULL) "
        "AND cancelled_from IS DISTINCT FROM 'cancelled' "
        "AND cancelled_from IS DISTINCT FROM 'signed' "
        "AND cancelled_from IS DISTINCT FROM 'amending'",
    )


def downgrade() -> None:
    op.drop_constraint("cancelled", "cases", type_="check")
    op.drop_column("cases", "cancelled_at")
    op.drop_column("cases", "cancelled_from")
    op.drop_column("cases", "state_changed_at")
