import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0086"
down_revision: str | None = "0085"
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
    "task-nudged",
    "task-reassigned",
    "task-due-changed",
    "upload-refused",
)
ADDED = ("adjudication-requested",)
TABLES = ("notifications", "notification_preferences")


def kind_check(kinds: Sequence[str]) -> str:
    allowed = ", ".join(f"'{kind}'" for kind in kinds)
    return f"kind IN ({allowed})"


def tenant_column() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False, index=True
    )


def person(name: str, *, nullable: bool = False) -> sa.Column[uuid.UUID]:
    return sa.Column(
        name,
        sa.Uuid[uuid.UUID](),
        sa.ForeignKey("users.id"),
        nullable=nullable,
        index=not nullable,
    )


def upgrade() -> None:
    op.create_table(
        "adjudications",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        tenant_column(),
        sa.Column(
            "task_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("review_tasks.id"),
            nullable=False,
            index=True,
        ),
        person("adjudicator_user_id"),
        person("sent_by_user_id", nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_note", sa.String(300), nullable=True),
        sa.CheckConstraint(
            "declined_note IS NULL OR declined_at IS NOT NULL", name="declined_with_note"
        ),
    )
    op.create_table(
        "adjudication_objects",
        sa.Column(
            "adjudication_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("adjudications.id"),
            primary_key=True,
        ),
        tenant_column(),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.ForeignKeyConstraint(
            ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
        ),
        sa.CheckConstraint("kind IN ('region', 'cell')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
    )
    for table in ("adjudications", "adjudication_objects"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check((*KINDS, *ADDED)))


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DELETE FROM {table} WHERE kind = 'adjudication-requested'")
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check(KINDS))
    op.drop_table("adjudication_objects")
    op.drop_table("adjudications")
