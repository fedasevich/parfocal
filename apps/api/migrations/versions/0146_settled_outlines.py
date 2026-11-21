from collections.abc import Sequence

from alembic import op

revision: str = "0146"
down_revision: str | None = "0145"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "disagreement_decisions"
DECIDED = "ck_disagreement_decisions_decided_or_left_open"
SETTLED = "(left_open OR value IS NOT NULL OR edits_settled_at IS NOT NULL"


def decided_check(extra: str) -> str:
    return (
        f"ALTER TABLE {TABLE} ADD CONSTRAINT {DECIDED} CHECK "
        f"(NOT (left_open AND value IS NOT NULL) AND {SETTLED}{extra}))"
    )


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {TABLE}"
        " ADD COLUMN outline geometry,"
        " ADD COLUMN outline_from_user_id uuid,"
        " ADD COLUMN outline_by_user_id uuid,"
        " ADD COLUMN outline_at timestamp with time zone,"
        " ADD CONSTRAINT fk_disagreement_decisions_outline_from_user_id_users"
        " FOREIGN KEY (outline_from_user_id) REFERENCES users (id),"
        " ADD CONSTRAINT fk_disagreement_decisions_outline_by_user_id_users"
        " FOREIGN KEY (outline_by_user_id) REFERENCES users (id),"
        " ADD CONSTRAINT ck_disagreement_decisions_outline_valid"
        " CHECK (outline IS NULL OR ST_IsValid(outline)),"
        " ADD CONSTRAINT ck_disagreement_decisions_outline_settled"
        " CHECK ((outline IS NULL) = (outline_at IS NULL)"
        " AND (outline IS NOT NULL OR outline_from_user_id IS NULL))"
    )
    op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT {DECIDED}")
    op.execute(decided_check(" OR outline IS NOT NULL"))


def downgrade() -> None:
    op.execute(f"DELETE FROM {TABLE} WHERE NOT {SETTLED})")
    op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT {DECIDED}")
    op.execute(decided_check(""))
    op.execute(
        f"ALTER TABLE {TABLE}"
        " DROP COLUMN outline,"
        " DROP COLUMN outline_from_user_id,"
        " DROP COLUMN outline_by_user_id,"
        " DROP COLUMN outline_at"
    )
