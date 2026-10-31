from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import PLATFORM_SETTING

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("memberships", "invitations")
ROLE_CHECK = "role IN ('researcher', 'reviewer')"
OLD_ROLE_CHECK = "role IN ('researcher', 'reviewer', 'admin')"
ADMIN_RIGHTS_CHECK = "NOT admin_rights OR role = 'researcher'"
PLATFORM_SCOPE = f"SELECT set_config('{PLATFORM_SETTING}', 'on', true)"


def upgrade() -> None:
    op.execute(PLATFORM_SCOPE)
    for table in TABLES:
        op.add_column(
            table,
            sa.Column("admin_rights", sa.Boolean, nullable=False, server_default=sa.false()),
        )
        op.drop_constraint("role", table, type_="check")
        op.execute(
            f"UPDATE {table} SET role = 'researcher', admin_rights = true WHERE role = 'admin'"
        )
        op.create_check_constraint("role", table, ROLE_CHECK)
        op.create_check_constraint("admin_rights", table, ADMIN_RIGHTS_CHECK)


def downgrade() -> None:
    op.execute(PLATFORM_SCOPE)
    for table in TABLES:
        op.drop_constraint("admin_rights", table, type_="check")
        op.drop_constraint("role", table, type_="check")
        op.execute(f"UPDATE {table} SET role = 'admin' WHERE admin_rights")
        op.drop_column(table, "admin_rights")
        op.create_check_constraint("role", table, OLD_ROLE_CHECK)
