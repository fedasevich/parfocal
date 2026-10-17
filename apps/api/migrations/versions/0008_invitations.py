import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import AUTH_SERVICE, PLATFORM_OPERATOR
from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_CHECK = "role IN ('researcher', 'reviewer', 'admin')"


def upgrade() -> None:
    op.create_table(
        "invitations",
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
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(ROLE_CHECK, name="role"),
    )
    for statement in [
        *enable_tenant_isolation("invitations"),
        f"CREATE POLICY auth_read ON invitations FOR SELECT USING ({AUTH_SERVICE})",
        f"CREATE POLICY platform_write ON invitations FOR ALL "
        f"USING ({PLATFORM_OPERATOR}) WITH CHECK ({PLATFORM_OPERATOR})",
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("invitations")
