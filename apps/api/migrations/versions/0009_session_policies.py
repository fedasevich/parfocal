import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import AUTH_SERVICE
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamps() -> list[sa.Column[datetime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "session_policies",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("idle_lock_minutes", sa.SmallInteger, nullable=False),
        sa.Column("session_hours", sa.SmallInteger, nullable=False),
        *timestamps(),
        sa.CheckConstraint("idle_lock_minutes BETWEEN 1 AND 240", name="idle_lock_minutes"),
        sa.CheckConstraint("session_hours BETWEEN 1 AND 24", name="session_hours"),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            nullable=False,
            unique=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "active_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.add_column("sessions", sa.Column("user_agent", sa.String(200), nullable=True))
    for statement in [
        *enable_tenant_isolation("session_policies"),
        f"CREATE POLICY auth_read ON session_policies FOR SELECT USING ({AUTH_SERVICE})",
        *track_updated_at("session_policies"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("session_policies")[0])
    op.drop_column("sessions", "user_agent")
    op.drop_column("sessions", "active_at")
    op.drop_column("sessions", "id")
    op.drop_table("session_policies")
