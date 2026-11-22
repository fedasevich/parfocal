from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0158"
down_revision: str | None = "0157"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETS = "result_sets"
OBJECTS = "result_objects"
ANNOTATIONS = "annotations"
SOURCE_CHECK = "source"
TOOL_CHECK = "tool"
DRAWER_KEY = "fk_result_objects_drawn_by_user_id_users"
TOOLS = "tool IN ('hand', 'smart-select')"


def upgrade() -> None:
    op.drop_constraint(SOURCE_CHECK, SETS, type_="check")
    op.create_check_constraint(SOURCE_CHECK, SETS, "source IN ('import', 'run', 'drawn')")
    op.add_column(OBJECTS, sa.Column("drawn_by_user_id", sa.Uuid()))
    op.add_column(OBJECTS, sa.Column("tool", sa.String(20)))
    op.create_foreign_key(op.f(DRAWER_KEY), OBJECTS, "users", ["drawn_by_user_id"], ["id"])
    op.create_check_constraint(TOOL_CHECK, OBJECTS, TOOLS)
    op.add_column(ANNOTATIONS, sa.Column("tool", sa.String(20)))
    op.create_check_constraint(TOOL_CHECK, ANNOTATIONS, TOOLS)


def downgrade() -> None:
    op.drop_constraint(TOOL_CHECK, ANNOTATIONS, type_="check")
    op.drop_column(ANNOTATIONS, "tool")
    op.drop_constraint(TOOL_CHECK, OBJECTS, type_="check")
    op.drop_constraint(op.f(DRAWER_KEY), OBJECTS, type_="foreignkey")
    op.drop_column(OBJECTS, "tool")
    op.drop_column(OBJECTS, "drawn_by_user_id")
    op.drop_constraint(SOURCE_CHECK, SETS, type_="check")
    op.create_check_constraint(SOURCE_CHECK, SETS, "source IN ('import', 'run')")
