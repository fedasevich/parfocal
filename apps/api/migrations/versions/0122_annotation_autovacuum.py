from collections.abc import Sequence

from alembic import op

revision: str = "0122"
down_revision: str | None = "0121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANNOTATION_TABLES = ("annotations", "annotation_versions")
AUTOVACUUM = {
    "autovacuum_vacuum_scale_factor": "0.02",
    "autovacuum_vacuum_insert_scale_factor": "0.05",
    "autovacuum_analyze_scale_factor": "0.01",
}


def upgrade() -> None:
    settings = ", ".join(f"{name} = {value}" for name, value in AUTOVACUUM.items())
    for table in ANNOTATION_TABLES:
        op.execute(f"ALTER TABLE {table} SET ({settings})")


def downgrade() -> None:
    names = ", ".join(AUTOVACUUM)
    for table in ANNOTATION_TABLES:
        op.execute(f"ALTER TABLE {table} RESET ({names})")
