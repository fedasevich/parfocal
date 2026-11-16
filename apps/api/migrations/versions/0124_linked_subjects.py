from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import AUTH_SERVICE, PLATFORM_OPERATOR

revision: str = "0124"
down_revision: str | None = "0123"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "linked_subjects"
ALLOWED = f"({AUTH_SERVICE}) OR ({PLATFORM_OPERATOR})"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("subject", sa.String(200), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sso_tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_linked_subjects_user_id", TABLE, ["user_id"])
    for statement in (
        f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY auth_or_platform ON {TABLE} USING ({ALLOWED}) WITH CHECK ({ALLOWED})",
    ):
        op.execute(statement)


def downgrade() -> None:
    op.execute(f"DROP POLICY auth_or_platform ON {TABLE}")
    op.drop_table(TABLE)
