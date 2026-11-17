from collections.abc import Sequence

from alembic import op

revision: str = "0135"
down_revision: str | None = "0134"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_memberships_availability"
WITH_BUSY = (
    "availability = 'away'"
    " OR (availability = 'busy' AND available_again_at IS NULL)"
    " OR (availability = 'available' AND available_again_at IS NULL AND availability_note IS NULL)"
)
WITHOUT_BUSY = (
    "availability = 'away'"
    " OR (availability = 'available' AND available_again_at IS NULL AND availability_note IS NULL)"
)


def replace(check: str) -> None:
    op.execute(f"ALTER TABLE memberships DROP CONSTRAINT {CONSTRAINT}")
    op.execute(f"ALTER TABLE memberships ADD CONSTRAINT {CONSTRAINT} CHECK ({check})")


def upgrade() -> None:
    replace(WITH_BUSY)


def downgrade() -> None:
    op.execute(
        "UPDATE memberships SET availability = 'available', availability_note = NULL"
        " WHERE availability = 'busy'"
    )
    replace(WITHOUT_BUSY)
