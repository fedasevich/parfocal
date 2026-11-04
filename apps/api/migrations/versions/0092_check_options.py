from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "0092"
down_revision: str | None = "0091"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_tasks", sa.Column("check_options", JSONB, nullable=True))
    op.create_check_constraint(
        "check_options", "review_tasks", "kind = 'annotate' OR check_options IS NULL"
    )
    op.add_column(
        "review_task_slides",
        sa.Column(
            "run_set_ids",
            ARRAY(sa.Uuid()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.create_check_constraint(
        "run_sets", "review_task_slides", "kind = 'annotate' OR cardinality(run_set_ids) = 0"
    )


def downgrade() -> None:
    op.drop_constraint("run_sets", "review_task_slides", type_="check")
    op.drop_column("review_task_slides", "run_set_ids")
    op.drop_constraint("check_options", "review_tasks", type_="check")
    op.drop_column("review_tasks", "check_options")
