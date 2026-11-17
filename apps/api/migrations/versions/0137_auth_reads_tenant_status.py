from collections.abc import Sequence

from alembic import op

revision: str = "0137"
down_revision: str | None = "0136"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUTH_SERVICE = "COALESCE(current_setting('app.auth', true), '') = 'on'"


def upgrade() -> None:
    op.execute(f"CREATE POLICY auth_read ON tenants FOR SELECT USING ({AUTH_SERVICE})")


def downgrade() -> None:
    op.execute("DROP POLICY auth_read ON tenants")
