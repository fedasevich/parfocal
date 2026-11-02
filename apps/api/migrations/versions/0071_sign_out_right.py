from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0071"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project_members", sa.Column("sign_out", sa.String(10), nullable=True))
    op.create_check_constraint("sign_out", "project_members", "sign_out IN ('own', 'any', 'never')")


def downgrade() -> None:
    op.drop_constraint("sign_out", "project_members", type_="check")
    op.drop_column("project_members", "sign_out")
