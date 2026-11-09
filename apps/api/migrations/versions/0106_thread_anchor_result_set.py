from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0106"
down_revision: str | None = "0105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("threads", sa.Column("result_set_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_threads_result_set_id_result_sets",
        "threads",
        "result_sets",
        ["result_set_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_threads_result_set_id_result_sets", "threads", type_="foreignkey")
    op.drop_column("threads", "result_set_id")
