from collections.abc import Sequence

from alembic import op

revision: str = "0139"
down_revision: str | None = "0138"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE review_tasks ADD COLUMN withdrawn_at timestamptz")
    op.execute(
        "ALTER TABLE review_tasks ADD COLUMN withdrawn_by_user_id uuid"
        " CONSTRAINT fk_review_tasks_withdrawn_by_user_id_users REFERENCES users (id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE review_tasks DROP COLUMN withdrawn_by_user_id")
    op.execute("ALTER TABLE review_tasks DROP COLUMN withdrawn_at")
