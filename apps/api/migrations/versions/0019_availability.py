import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BACKUP_KEY = "fk_memberships_tenant_id_backup_user_id_memberships"
AVAILABILITY_CHECK = (
    "(availability = 'available' AND available_again_at IS NULL AND backup_user_id IS NULL)"
    " OR (availability = 'busy' AND available_again_at IS NOT NULL AND backup_user_id IS NULL)"
    " OR (availability = 'away' AND backup_user_id IS NOT NULL)"
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
    op.add_column("memberships", sa.Column("backup_user_id", sa.Uuid[uuid.UUID](), nullable=True))
    op.create_foreign_key(
        BACKUP_KEY,
        "memberships",
        "memberships",
        ["tenant_id", "backup_user_id"],
        ["tenant_id", "user_id"],
    )
    op.create_check_constraint("availability", "memberships", AVAILABILITY_CHECK)
    op.create_check_constraint(
        "own_backup", "memberships", "backup_user_id IS DISTINCT FROM user_id"
    )


def downgrade() -> None:
    op.drop_constraint("own_backup", "memberships", type_="check")
    op.drop_constraint("availability", "memberships", type_="check")
    op.drop_constraint(BACKUP_KEY, "memberships", type_="foreignkey")
    op.drop_column("memberships", "backup_user_id")
    op.drop_column("memberships", "available_again_at")
    op.drop_column("memberships", "availability")
