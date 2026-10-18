import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "announcements",
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
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("text", sa.String(280), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind IN ('model', 'slowdown', 'change')", name="kind"),
    )
    op.create_index(
        "ix_announcements_tenant_id_created_at", "announcements", ["tenant_id", "created_at"]
    )
    for statement in [
        *enable_tenant_isolation("announcements"),
        *track_updated_at("announcements"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("announcements")[0])
    op.drop_table("announcements")
