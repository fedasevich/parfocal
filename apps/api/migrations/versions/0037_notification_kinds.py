from collections.abc import Sequence

from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = (
    "mention",
    "reply",
    "task-assigned",
    "model-run-finished",
    "model-run-paused",
    "upload-done",
    "disagreements-ready",
    "task-signed-off",
    "emergency-access",
)
ADDED = ("task-due-soon", "result-set-added", "integration-down")
TABLES = ("notifications", "notification_preferences")


def kind_check(kinds: Sequence[str]) -> str:
    allowed = ", ".join(f"'{kind}'" for kind in kinds)
    return f"kind IN ({allowed})"


def upgrade() -> None:
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check((*KINDS, *ADDED)))


def downgrade() -> None:
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check(KINDS))
