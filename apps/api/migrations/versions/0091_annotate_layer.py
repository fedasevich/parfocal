from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0091"
down_revision: str | None = "0090"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("origin", sa.String(10), nullable=False, server_default="human"),
    )
    op.add_column("annotations", sa.Column("source_number", sa.Integer, nullable=True))
    op.create_check_constraint("origin", "annotations", "origin IN ('human', 'ai-edited')")
    op.create_check_constraint(
        "source", "annotations", "(origin = 'ai-edited') = (source_number IS NOT NULL)"
    )
    op.create_check_constraint(
        "source_task", "annotations", "origin = 'human' OR task_id IS NOT NULL"
    )
    op.create_index(
        "uq_annotations_source",
        "annotations",
        ["task_id", "slide_id", "kind", "source_number"],
        unique=True,
        postgresql_where=sa.text("source_number IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM annotation_versions WHERE annotation_id IN "
        "(SELECT id FROM annotations WHERE origin = 'ai-edited')"
    )
    op.execute("DELETE FROM annotations WHERE origin = 'ai-edited'")
    op.drop_index("uq_annotations_source", "annotations")
    op.drop_constraint("source_task", "annotations", type_="check")
    op.drop_constraint("source", "annotations", type_="check")
    op.drop_constraint("origin", "annotations", type_="check")
    op.drop_column("annotations", "source_number")
    op.drop_column("annotations", "origin")
