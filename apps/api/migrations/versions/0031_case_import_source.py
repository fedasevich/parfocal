from collections.abc import Sequence

from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_cases_source"), "cases", type_="check")
    op.create_check_constraint("source", "cases", "source IN ('manual', 'upload', 'import')")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_cases_source"), "cases", type_="check")
    op.create_check_constraint("source", "cases", "source IN ('manual', 'upload')")
