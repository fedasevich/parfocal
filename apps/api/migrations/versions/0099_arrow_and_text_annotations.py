from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0099"
down_revision: str | None = "0098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("annotations", sa.Column("text", sa.String(200), nullable=True))
    op.add_column("annotation_versions", sa.Column("text", sa.String(200), nullable=True))
    op.drop_constraint("kind", "annotations", type_="check")
    op.create_check_constraint(
        "kind", "annotations", "kind IN ('roi', 'measurement', 'region', 'cell', 'arrow', 'text')"
    )
    op.create_check_constraint("text", "annotations", "(kind = 'text') = (text IS NOT NULL)")
    op.drop_constraint("letter", "slide_counters", type_="check")
    op.create_check_constraint(
        "letter", "slide_counters", "letter IN ('T', 'C', 'R', 'Z', 'M', 'A', 'N')"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM annotation_versions WHERE annotation_id IN "
        "(SELECT id FROM annotations WHERE kind IN ('arrow', 'text'))"
    )
    op.execute("DELETE FROM annotations WHERE kind IN ('arrow', 'text')")
    op.execute("DELETE FROM slide_counters WHERE letter IN ('A', 'N')")
    op.drop_constraint("letter", "slide_counters", type_="check")
    op.create_check_constraint("letter", "slide_counters", "letter IN ('T', 'C', 'R', 'Z', 'M')")
    op.drop_constraint("text", "annotations", type_="check")
    op.drop_constraint("kind", "annotations", type_="check")
    op.create_check_constraint(
        "kind", "annotations", "kind IN ('roi', 'measurement', 'region', 'cell')"
    )
    op.drop_column("annotation_versions", "text")
    op.drop_column("annotations", "text")
