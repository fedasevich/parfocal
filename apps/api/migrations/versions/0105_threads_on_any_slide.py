from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0105"
down_revision: str | None = "0104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("threads", "task_id", existing_type=sa.Uuid(), nullable=True)
    op.create_index(
        "ix_threads_project_id_slide_id_taskless",
        "threads",
        ["project_id", "slide_id"],
        postgresql_where=sa.text("task_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_threads_project_id_slide_id_taskless", table_name="threads")
    op.execute("DELETE FROM threads WHERE task_id IS NULL")
    op.alter_column("threads", "task_id", existing_type=sa.Uuid(), nullable=False)
