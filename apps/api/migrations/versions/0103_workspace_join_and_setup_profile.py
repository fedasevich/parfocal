import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

from parfocal_common.db import CURRENT_TENANT
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0103"
down_revision: str | None = "0102"
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
)
ADDED = ("workspace-access-asked",)
TABLES = ("notifications", "notification_preferences")
ASKING_FOR_CURRENT_TENANT = (
    "SELECT user_id FROM workspace_access_requests "
    f"WHERE tenant_id = {CURRENT_TENANT} AND status = 'pending'"
)


def kind_check(kinds: Sequence[str]) -> str:
    allowed = ", ".join(f"'{kind}'" for kind in kinds)
    return f"kind IN ({allowed})"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("specialties", ARRAY(sa.String(60)), nullable=False, server_default="{}"),
    )
    op.add_column("tenants", sa.Column("email_domain", sa.String(253), nullable=True))
    op.add_column(
        "tenants",
        sa.Column("join_policy", sa.String(10), nullable=False, server_default="join"),
    )
    op.add_column("tenants", sa.Column("logo", sa.String(3), nullable=True))
    op.add_column("tenants", sa.Column("logo_colour", sa.String(7), nullable=True))
    op.create_index("ix_tenants_email_domain", "tenants", ["email_domain"])
    op.create_check_constraint("join_policy", "tenants", "join_policy IN ('join', 'ask')")
    op.create_check_constraint("logo", "tenants", "logo ~ '^[A-Z0-9]{1,3}$'")
    op.create_check_constraint("logo_colour", "tenants", "logo_colour ~ '^#[0-9a-f]{6}$'")
    op.create_table(
        "workspace_access_requests",
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
        sa.Column("user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column(
            "asked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.CheckConstraint("status IN ('pending', 'approved')", name="status"),
        sa.CheckConstraint("(status = 'pending') = (decided_at IS NULL)", name="decided_at"),
    )
    op.create_index(
        "ux_workspace_access_requests_pending",
        "workspace_access_requests",
        ["tenant_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    for statement in enable_tenant_isolation("workspace_access_requests"):
        op.execute(statement)
    op.execute(
        "CREATE POLICY users_asking ON users FOR SELECT "
        f"USING (id IN ({ASKING_FOR_CURRENT_TENANT}))"
    )
    for table in TABLES:
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check((*KINDS, *ADDED)))


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DELETE FROM {table} WHERE kind = 'workspace-access-asked'")
        op.drop_constraint("kind", table, type_="check")
        op.create_check_constraint("kind", table, kind_check(KINDS))
    op.execute("DROP POLICY users_asking ON users")
    op.drop_table("workspace_access_requests")
    op.drop_constraint("logo_colour", "tenants", type_="check")
    op.drop_constraint("logo", "tenants", type_="check")
    op.drop_constraint("join_policy", "tenants", type_="check")
    op.drop_index("ix_tenants_email_domain", "tenants")
    op.drop_column("tenants", "logo_colour")
    op.drop_column("tenants", "logo")
    op.drop_column("tenants", "join_policy")
    op.drop_column("tenants", "email_domain")
    op.drop_column("users", "specialties")
