from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0098"
down_revision: str | None = "0097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("annotations", "origin", type_=sa.String(16), existing_type=sa.String(10))
    op.drop_constraint("origin", "annotations", type_="check")
    op.create_check_constraint(
        "origin", "annotations", "origin IN ('human', 'ai-edited', 'ai-confirmed')"
    )
    op.drop_constraint("source", "annotations", type_="check")
    op.create_check_constraint(
        "source", "annotations", "(origin <> 'human') = (source_number IS NOT NULL)"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM annotation_versions WHERE annotation_id IN "
        "(SELECT id FROM annotations WHERE origin = 'ai-confirmed')"
    )
    op.execute("DELETE FROM annotations WHERE origin = 'ai-confirmed'")
    op.drop_constraint("source", "annotations", type_="check")
    op.create_check_constraint(
        "source", "annotations", "(origin = 'ai-edited') = (source_number IS NOT NULL)"
    )
    op.drop_constraint("origin", "annotations", type_="check")
    op.create_check_constraint("origin", "annotations", "origin IN ('human', 'ai-edited')")
    op.alter_column("annotations", "origin", type_=sa.String(10), existing_type=sa.String(16))
