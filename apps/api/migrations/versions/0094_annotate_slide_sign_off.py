from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0094"
down_revision: str | None = "0093"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_assignments",
        sa.Column("nothing_to_mark", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "nothing_to_mark", "review_assignments", "NOT nothing_to_mark OR submitted_at IS NOT NULL"
    )
    op.add_column(
        "review_task_slides",
        sa.Column("signed_off_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "review_task_slides",
        sa.Column("signed_off_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_check_constraint(
        "slide_sign_off", "review_task_slides", "kind = 'annotate' OR signed_off_at IS NULL"
    )


def downgrade() -> None:
    op.drop_constraint("slide_sign_off", "review_task_slides", type_="check")
    op.drop_column("review_task_slides", "signed_off_by_user_id")
    op.drop_column("review_task_slides", "signed_off_at")
    op.drop_constraint("nothing_to_mark", "review_assignments", type_="check")
    op.drop_column("review_assignments", "nothing_to_mark")
