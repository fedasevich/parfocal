from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHECKS = {
    "split": "split ~ '^[a-z]*$'",
    "retired": "retired IN ('split', 'merged')",
    "merged_into": "(retired = 'merged') = "
    "(merged_into_number IS NOT NULL AND merged_into_split IS NOT NULL)",
}
KEY = ["task_id", "slide_id", "user_id", "kind", "number"]


def upgrade() -> None:
    op.add_column(
        "review_edits",
        sa.Column("split", sa.String(26), nullable=False, server_default=sa.text("''")),
    )
    op.add_column("review_edits", sa.Column("retired", sa.String(10), nullable=True))
    op.add_column("review_edits", sa.Column("merged_into_number", sa.Integer(), nullable=True))
    op.add_column("review_edits", sa.Column("merged_into_split", sa.String(26), nullable=True))
    op.drop_constraint("pk_review_edits", "review_edits", type_="primary")
    op.create_primary_key("pk_review_edits", "review_edits", [*KEY, "split"])
    op.drop_constraint("changes_something", "review_edits", type_="check")
    op.create_check_constraint(
        "changes_something",
        "review_edits",
        "deleted OR retired IS NOT NULL OR class_id IS NOT NULL OR geometry IS NOT NULL",
    )
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, "review_edits", condition)


def downgrade() -> None:
    op.execute("DELETE FROM review_edits WHERE split <> '' OR retired IS NOT NULL")
    for name in CHECKS:
        op.drop_constraint(name, "review_edits", type_="check")
    op.drop_constraint("changes_something", "review_edits", type_="check")
    op.create_check_constraint(
        "changes_something",
        "review_edits",
        "deleted OR class_id IS NOT NULL OR geometry IS NOT NULL",
    )
    op.drop_constraint("pk_review_edits", "review_edits", type_="primary")
    op.create_primary_key("pk_review_edits", "review_edits", KEY)
    for column in ("merged_into_split", "merged_into_number", "retired", "split"):
        op.drop_column("review_edits", column)
