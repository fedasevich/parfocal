from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0159_case_requested_by"
down_revision: str | None = "0158"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("requested_by", sa.String(200)))


def downgrade() -> None:
    op.drop_column("cases", "requested_by")
