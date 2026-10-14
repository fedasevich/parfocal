import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memberships", sa.Column("signs_alone", sa.Boolean, nullable=True))
    op.add_column(
        "memberships",
        sa.Column(
            "supervisor_user_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "own_supervisor", "memberships", "supervisor_user_id IS DISTINCT FROM user_id"
    )
    op.add_column("users", sa.Column("signature", sa.LargeBinary, nullable=True))
    op.add_column(
        "users", sa.Column("signature_added_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "signature_added_at", "users", "(signature IS NULL) = (signature_added_at IS NULL)"
    )


def downgrade() -> None:
    op.drop_constraint("signature_added_at", "users", type_="check")
    op.drop_column("users", "signature_added_at")
    op.drop_column("users", "signature")
    op.drop_constraint("own_supervisor", "memberships", type_="check")
    op.drop_column("memberships", "supervisor_user_id")
    op.drop_column("memberships", "signs_alone")
