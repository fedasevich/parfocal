from collections.abc import Sequence

from alembic import op

revision: str = "0144"
down_revision: str | None = "0143"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE review_tasks ADD COLUMN outline_overlap smallint DEFAULT 60 NOT NULL"
        " CONSTRAINT ck_review_tasks_outline_overlap CHECK (outline_overlap BETWEEN 1 AND 99)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE review_tasks DROP COLUMN outline_overlap")
