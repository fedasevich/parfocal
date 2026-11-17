from collections.abc import Sequence

from alembic import op

revision: str = "project_access_notification"
down_revision: str | None = "0128"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KIND = "project-access-asked"
CONSTRAINTS = (
    ("notifications", "ck_notifications_kind"),
    ("notification_preferences", "ck_notification_preferences_kind"),
)
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
    "task-due-soon",
    "result-set-added",
    "integration-down",
    "task-nudged",
    "task-reassigned",
    "task-due-changed",
    "upload-refused",
    "adjudication-requested",
    "slide-moved",
    "workspace-access-asked",
    "template-offered",
)


def listed(kinds: Sequence[str]) -> str:
    return ", ".join(f"'{kind}'" for kind in kinds)


def replace(kinds: Sequence[str]) -> None:
    for table, constraint in CONSTRAINTS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {constraint}")
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {constraint} CHECK (kind IN ({listed(kinds)}))"
        )


def upgrade() -> None:
    replace((*KINDS, KIND))


def downgrade() -> None:
    op.execute(f"DELETE FROM notifications WHERE kind = '{KIND}'")
    op.execute(f"DELETE FROM notification_preferences WHERE kind = '{KIND}'")
    replace(KINDS)
