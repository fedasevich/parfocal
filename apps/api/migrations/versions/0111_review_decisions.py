from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0111"
down_revision: str | None = "0110"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_TABLE = "verdicts"
NEW_TABLE = "review_decisions"

CONSTRAINTS = """
SELECT conname FROM pg_constraint
WHERE conrelid = CAST(:table AS regclass) AND conname LIKE :prefix
ORDER BY conname
"""

INDEXES = """
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = :table AND indexname LIKE :prefix
ORDER BY indexname
"""


def renamed(name: str, old: str, new: str) -> str:
    kind, rest = name.split("_", 1)
    return f"{kind}_{new}{rest[len(old) :]}"


def rename_table(old: str, new: str) -> None:
    connection = op.get_bind()
    op.rename_table(old, new)
    op.execute(f"ALTER TRIGGER {old}_touch_updated_at ON {new} RENAME TO {new}_touch_updated_at")
    op.execute(f"ALTER TABLE {new} RENAME CONSTRAINT pk_{old} TO pk_{new}")
    for prefix in ("fk", "ck", "uq"):
        names = connection.execute(
            sa.text(CONSTRAINTS), {"table": new, "prefix": f"{prefix}\\_{old}\\_%"}
        ).scalars()
        for name in list(names):
            op.execute(f"ALTER TABLE {new} RENAME CONSTRAINT {name} TO {renamed(name, old, new)}")
    not_null = connection.execute(
        sa.text(CONSTRAINTS), {"table": new, "prefix": f"{old}\\_%\\_not\\_null"}
    ).scalars()
    for name in list(not_null):
        op.execute(f"ALTER TABLE {new} RENAME CONSTRAINT {name} TO {new}{name[len(old) :]}")
    indexes = connection.execute(
        sa.text(INDEXES), {"table": new, "prefix": f"ix\\_{old}\\_%"}
    ).scalars()
    for name in list(indexes):
        op.execute(f"ALTER INDEX {name} RENAME TO {renamed(name, old, new)}")


def upgrade() -> None:
    rename_table(OLD_TABLE, NEW_TABLE)


def downgrade() -> None:
    rename_table(NEW_TABLE, OLD_TABLE)
