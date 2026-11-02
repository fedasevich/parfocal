from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FORMATS_BEFORE = "result_format IN ('geojson', 'parfocal-json', 'csv')"
FORMATS_AFTER = "result_format IN ('geojson', 'parfocal-json', 'csv', 'heatmap')"


def upgrade() -> None:
    op.add_column("uploads", sa.Column("import_problems", postgresql.JSONB, nullable=True))
    op.add_column("uploads", sa.Column("import_choices", postgresql.JSONB, nullable=True))
    op.drop_constraint("result_format", "uploads", type_="check")
    op.create_check_constraint("result_format", "uploads", FORMATS_AFTER)


def downgrade() -> None:
    op.execute("DELETE FROM uploads WHERE result_format = 'heatmap'")
    op.drop_constraint("result_format", "uploads", type_="check")
    op.create_check_constraint("result_format", "uploads", FORMATS_BEFORE)
    op.drop_column("uploads", "import_choices")
    op.drop_column("uploads", "import_problems")
