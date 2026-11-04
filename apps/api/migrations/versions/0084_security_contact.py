from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0084"
down_revision: str | None = "0083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace_settings", sa.Column("security_contact", sa.String(320), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("workspace_settings", "security_contact")
