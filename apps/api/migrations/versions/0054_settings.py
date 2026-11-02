import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def updated_at() -> sa.Column[datetime]:
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "personal_settings",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("values", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        updated_at(),
        sa.PrimaryKeyConstraint("tenant_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
    )
    op.create_table(
        "workspace_settings",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("values", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("locked", ARRAY(sa.String(40)), nullable=False, server_default="{}"),
        updated_at(),
        sa.PrimaryKeyConstraint("tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    for table in ("personal_settings", "workspace_settings"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)


def downgrade() -> None:
    op.drop_table("workspace_settings")
    op.drop_table("personal_settings")
