import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import AUTH_SERVICE
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0089"
down_revision: str | None = "0088"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_links",
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
        sa.Column(
            "task_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("review_tasks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    for statement in [
        *enable_tenant_isolation("report_links"),
        f"CREATE POLICY auth_read ON report_links FOR SELECT USING ({AUTH_SERVICE})",
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("report_links")
