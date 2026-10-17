import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0018"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "emergency_grants",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column(
            "granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
    )
    op.create_index(
        "ix_emergency_grants_user_id_case_id", "emergency_grants", ["user_id", "case_id"]
    )
    op.add_column(
        "session_policies",
        sa.Column("emergency_hours", sa.SmallInteger, nullable=False, server_default="4"),
    )
    op.create_check_constraint(
        "emergency_hours", "session_policies", "emergency_hours BETWEEN 1 AND 24"
    )
    for statement in enable_tenant_isolation("emergency_grants"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_constraint("emergency_hours", "session_policies", type_="check")
    op.drop_column("session_policies", "emergency_hours")
    op.drop_table("emergency_grants")
