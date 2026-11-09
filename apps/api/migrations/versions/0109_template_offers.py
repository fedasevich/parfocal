import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0109"
down_revision: str | None = "0108"
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
    "adjudication-requested",
    "slide-moved",
    "workspace-access-asked",
)
ADDED = ("template-offered",)
TABLES = ("notifications", "notification_preferences")
STUDY_KINDS = ("regions-and-cells", "regions", "outlines", "cells", "reviewers-first", "other")


def kind_check(kinds: Sequence[str]) -> str:
    allowed = ", ".join(f"'{kind}'" for kind in kinds)
    return f"kind IN ({allowed})"


def upgrade() -> None:
    op.create_table(
        "template_offers",
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
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("study_kind", sa.String(20), nullable=False),
        sa.Column("blocks", JSONB, nullable=False),
        sa.Column("format", JSONB, nullable=False),
        sa.Column("presets", JSONB, nullable=False),
        sa.Column(
            "offered_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("template_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="status"),
        sa.CheckConstraint(
            "study_kind IN (" + ", ".join(f"'{kind}'" for kind in STUDY_KINDS) + ")",
            name="study_kind",
        ),
        sa.CheckConstraint("(status = 'pending') = (decided_at IS NULL)", name="decided_at"),
    )
    for statement in enable_tenant_isolation("template_offers"):
        op.execute(statement)
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check((*KINDS, *ADDED)))


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DELETE FROM {table} WHERE kind = 'template-offered'")
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check(KINDS))
    op.drop_table("template_offers")
