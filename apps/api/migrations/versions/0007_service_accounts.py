import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.db import AUTH_SERVICE
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCOPES_CHECK = (
    "scopes <@ ARRAY['see-slides', 'create-cases', 'upload-slides', 'see-people']::varchar[] "
    "AND cardinality(scopes) > 0"
)
ACTOR_KINDS = "'user', 'member', 'operator', 'system'"


def actor_kind_check(kinds: str) -> str:
    return f"actor_kind IN ({kinds})"


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
        "service_accounts",
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
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String(40)), nullable=False),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("tenant_id", "name"),
        sa.CheckConstraint(SCOPES_CHECK, name="scopes"),
    )
    op.create_table(
        "api_tokens",
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
            "service_account_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("service_accounts.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.drop_constraint("actor_kind", "audit_events", type_="check")
    op.create_check_constraint(
        "actor_kind", "audit_events", actor_kind_check(f"{ACTOR_KINDS}, 'service'")
    )
    for statement in [
        *enable_tenant_isolation("service_accounts"),
        *enable_tenant_isolation("api_tokens"),
        f"CREATE POLICY auth_read ON service_accounts FOR SELECT USING ({AUTH_SERVICE})",
        f"CREATE POLICY auth_read ON api_tokens FOR SELECT USING ({AUTH_SERVICE})",
        f"CREATE POLICY auth_touch ON api_tokens FOR UPDATE "
        f"USING ({AUTH_SERVICE}) WITH CHECK ({AUTH_SERVICE})",
        *track_updated_at("service_accounts"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("service_accounts")[0])
    op.drop_constraint("actor_kind", "audit_events", type_="check")
    op.create_check_constraint("actor_kind", "audit_events", actor_kind_check(ACTOR_KINDS))
    op.drop_table("api_tokens")
    op.drop_table("service_accounts")
