import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation, track_updated_at, untrack_updated_at

revision: str = "0023"
down_revision: str | None = "0022"
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


def kind_check() -> sa.CheckConstraint:
    allowed = ", ".join(f"'{kind}'" for kind in KINDS)
    return sa.CheckConstraint(f"kind IN ({allowed})", name="kind")


def upgrade() -> None:
    op.create_table(
        "notifications",
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
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("target_type", sa.String(30), nullable=False),
        sa.Column("target_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("in_app", sa.Boolean, nullable=False),
        sa.Column("realtime", sa.Boolean, nullable=False),
        sa.Column("email_status", sa.String(10), nullable=False),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        kind_check(),
        sa.CheckConstraint("email_status IN ('none', 'pending', 'sent', 'skipped')", name="email"),
    )
    op.create_index(
        "ix_notifications_user_id_created_at", "notifications", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_notifications_pending_email",
        "notifications",
        ["tenant_id"],
        postgresql_where=sa.text("email_status = 'pending'"),
    )
    op.create_table(
        "notification_preferences",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("in_app", sa.Boolean, nullable=False),
        sa.Column("email", sa.Boolean, nullable=False),
        sa.Column("realtime", sa.Boolean, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("tenant_id", "user_id", "kind"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        kind_check(),
    )
    for statement in [
        *enable_tenant_isolation("notifications"),
        *enable_tenant_isolation("notification_preferences"),
        *track_updated_at("notification_preferences"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("notification_preferences")[0])
    op.drop_table("notification_preferences")
    op.drop_table("notifications")
