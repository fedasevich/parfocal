from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0127"
down_revision: str | None = "0126"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "lab_model_projects"
CONFIRMER_KEY = "fk_lab_model_projects_tiles_confirmed_by_user_id_users"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("tiles_confirmed_at", sa.DateTime(timezone=True)))
    op.add_column(TABLE, sa.Column("tiles_confirmed_by_user_id", sa.Uuid()))
    op.create_foreign_key(CONFIRMER_KEY, TABLE, "users", ["tiles_confirmed_by_user_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint(CONFIRMER_KEY, TABLE, type_="foreignkey")
    op.drop_column(TABLE, "tiles_confirmed_by_user_id")
    op.drop_column(TABLE, "tiles_confirmed_at")
