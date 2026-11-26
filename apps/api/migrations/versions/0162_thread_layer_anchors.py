from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0162"
down_revision: str | None = "0161"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "threads"
KIND_CHECK = op.f("ck_threads_anchor_kind")
LAYER_CHECK = op.f("ck_threads_layer_anchor")
KINDS = "'object', 'roi', 'point', 'shape'"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("layer", sa.String(100)))
    op.drop_constraint(KIND_CHECK, TABLE, type_="check")
    op.create_check_constraint(KIND_CHECK, TABLE, f"anchor_kind IN ({KINDS}, 'layer')")
    op.create_check_constraint(LAYER_CHECK, TABLE, "(anchor_kind = 'layer') = (layer IS NOT NULL)")


def downgrade() -> None:
    op.drop_constraint(LAYER_CHECK, TABLE, type_="check")
    op.execute("DELETE FROM threads WHERE anchor_kind = 'layer'")
    op.drop_constraint(KIND_CHECK, TABLE, type_="check")
    op.create_check_constraint(KIND_CHECK, TABLE, f"anchor_kind IN ({KINDS})")
    op.drop_column(TABLE, "layer")
