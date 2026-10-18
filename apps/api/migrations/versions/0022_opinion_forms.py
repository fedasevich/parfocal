import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "opinion_forms",
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
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("version", sa.SmallInteger, nullable=False),
        sa.Column("questions", postgresql.JSONB, nullable=False),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("project_id", "version"),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("version >= 1", name="version"),
    )
    for statement in enable_tenant_isolation("opinion_forms"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("opinion_forms")
