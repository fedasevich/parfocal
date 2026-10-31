import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import PLATFORM_SETTING, TENANT_SETTING
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONTEXT = ("project_id", "task_id", "case_id")
PLATFORM_SCOPE = f"SELECT set_config('{PLATFORM_SETTING}', 'on', true)"
TENANT_SCOPE = f"SELECT set_config('{TENANT_SETTING}', :tenant, true)"
UUID_PATTERN = "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"
BACKFILL = (
    "UPDATE notifications n SET project_id = t.project_id, task_id = t.id "
    "FROM review_tasks t WHERE n.target_type IN ('task', 'evaluation') AND t.id = n.target_id",
    "UPDATE notifications n SET project_id = s.project_id, case_id = s.case_id, "
    f"task_id = CASE WHEN n.payload->>'task_id' ~ {UUID_PATTERN} "
    "THEN (n.payload->>'task_id')::uuid END "
    "FROM slides s WHERE n.target_type = 'slide' AND s.id = n.target_id",
    "UPDATE notifications n SET project_id = j.project_id "
    "FROM jobs j WHERE n.target_type = 'job' AND j.id = n.target_id",
    "UPDATE notifications n SET project_id = p.id "
    "FROM projects p WHERE n.target_type = 'project' AND p.id = n.target_id",
)


def upgrade() -> None:
    for column in CONTEXT:
        op.add_column("notifications", sa.Column(column, sa.Uuid[uuid.UUID](), nullable=True))
    op.create_index(
        "ix_notifications_user_id_unread",
        "notifications",
        ["user_id", "kind"],
        postgresql_where=sa.text("read_at IS NULL"),
    )
    op.create_table(
        "notification_mutes",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("subject", sa.String(10), nullable=False),
        sa.Column("subject_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("tenant_id", "user_id", "subject", "subject_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("subject IN ('project', 'task', 'case')", name="subject"),
    )
    for statement in enable_tenant_isolation("notification_mutes"):
        op.execute(statement)
    op.execute(PLATFORM_SCOPE)
    bind = op.get_bind()
    for tenant in bind.execute(sa.text("SELECT id FROM tenants")).scalars().all():
        bind.execute(sa.text(TENANT_SCOPE), {"tenant": str(tenant)})
        for statement in BACKFILL:
            bind.execute(sa.text(statement))


def downgrade() -> None:
    op.drop_table("notification_mutes")
    op.drop_index("ix_notifications_user_id_unread", table_name="notifications")
    for column in reversed(CONTEXT):
        op.drop_column("notifications", column)
