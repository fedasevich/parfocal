from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0157"
down_revision: str | None = "0156"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "disagreement_decisions"
COLUMN = "kept_class_id"
CLASS_KEY = "fk_disagreement_decisions_kept_class_id_project_id_tenant_id"
KEPT_CHECK = "ck_disagreement_decisions_kept_type"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column(COLUMN, sa.Uuid()))
    op.create_foreign_key(
        CLASS_KEY,
        TABLE,
        "project_classes",
        [COLUMN, "project_id", "tenant_id"],
        ["id", "project_id", "tenant_id"],
    )
    op.create_check_constraint(
        KEPT_CHECK, TABLE, "kept_class_id IS NULL OR (answer IS NULL AND value = 'disagree')"
    )


def downgrade() -> None:
    op.drop_constraint(KEPT_CHECK, TABLE, type_="check")
    op.drop_constraint(CLASS_KEY, TABLE, type_="foreignkey")
    op.drop_column(TABLE, COLUMN)
