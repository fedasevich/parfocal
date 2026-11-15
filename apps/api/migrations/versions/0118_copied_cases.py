from collections.abc import Sequence

from alembic import op

revision: str = "0118"
down_revision: str | None = "0117"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_cases_source"


def upgrade() -> None:
    op.execute(f"ALTER TABLE cases DROP CONSTRAINT {CONSTRAINT}")
    op.execute(
        f"ALTER TABLE cases ADD CONSTRAINT {CONSTRAINT} "
        "CHECK (source IN ('manual', 'upload', 'import', 'copy'))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE cases DROP CONSTRAINT {CONSTRAINT}")
    op.execute(
        f"ALTER TABLE cases ADD CONSTRAINT {CONSTRAINT} "
        "CHECK (source IN ('manual', 'upload', 'import'))"
    )
