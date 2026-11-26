from collections.abc import Sequence

from alembic import op

revision: str = "0163"
down_revision: str | None = "0162"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_memberships_role"
WITH_PARTICIPANT = "role IN ('researcher', 'reviewer', 'study-participant')"
WITHOUT_PARTICIPANT = "role IN ('researcher', 'reviewer')"


def replace(check: str) -> None:
    op.execute(f"ALTER TABLE memberships DROP CONSTRAINT {CONSTRAINT}")
    op.execute(f"ALTER TABLE memberships ADD CONSTRAINT {CONSTRAINT} CHECK ({check})")


def upgrade() -> None:
    replace(WITH_PARTICIPANT)


def downgrade() -> None:
    op.execute("UPDATE memberships SET role = 'researcher' WHERE role = 'study-participant'")
    replace(WITHOUT_PARTICIPANT)
