import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0074"
down_revision: str | None = "0073"
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
    "task-due-soon",
    "result-set-added",
    "integration-down",
)
ADDED = ("task-nudged", "task-reassigned", "task-due-changed")
TABLES = ("notifications", "notification_preferences")


def kind_check(kinds: Sequence[str]) -> str:
    allowed = ", ".join(f"'{kind}'" for kind in kinds)
    return f"kind IN ({allowed})"


def owned_columns() -> list[sa.Column[uuid.UUID]]:
    return [
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
    ]


def task_column() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "task_id",
        sa.Uuid[uuid.UUID](),
        sa.ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
    )


def person(name: str, *, nullable: bool = False) -> sa.Column[uuid.UUID]:
    return sa.Column(name, sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=nullable)


def moment(name: str, *, nullable: bool = False) -> sa.Column[datetime]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "task_nudges",
        *owned_columns(),
        task_column(),
        person("user_id"),
        person("sent_by_user_id", nullable=True),
        moment("sent_at"),
    )
    op.create_table(
        "task_reassignments",
        *owned_columns(),
        task_column(),
        person("from_user_id"),
        person("to_user_id"),
        sa.Column("what", sa.String(12), nullable=False),
        sa.Column("slide_ids", postgresql.ARRAY(sa.Uuid[uuid.UUID]()), nullable=False),
        sa.Column("kept_slide_ids", postgresql.ARRAY(sa.Uuid[uuid.UUID]()), nullable=False),
        moment("created_at"),
        moment("undone_at", nullable=True),
        sa.CheckConstraint("what IN ('not-started', 'all')", name="what"),
        sa.CheckConstraint("from_user_id <> to_user_id", name="two_people"),
    )
    for table in ("task_nudges", "task_reassignments"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    op.add_column(
        "review_assignments",
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
    )
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check((*KINDS, *ADDED)))


def downgrade() -> None:
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check(KINDS))
    op.drop_column("review_assignments", "released_at")
    op.drop_table("task_reassignments")
    op.drop_table("task_nudges")
