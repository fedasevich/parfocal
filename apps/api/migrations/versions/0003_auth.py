from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import disable_auth_only, enable_auth_only

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("platform_operators", "auth_logins", "sessions")


def created_at() -> sa.Column[datetime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "platform_operators",
        sa.Column("subject", sa.String(200), primary_key=True),
        created_at(),
    )
    op.create_table(
        "auth_logins",
        sa.Column("state_hash", sa.LargeBinary, primary_key=True),
        sa.Column("binding_hash", sa.LargeBinary, nullable=False),
        sa.Column("code_verifier", sa.String(200), nullable=False),
        sa.Column("nonce", sa.String(200), nullable=False),
        sa.Column("return_to", sa.String(2000), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
    )
    op.create_table(
        "sessions",
        sa.Column("id_hash", sa.LargeBinary, primary_key=True),
        sa.Column("subject", sa.String(200), nullable=False, index=True),
        sa.Column("tokens", sa.LargeBinary, nullable=False),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        created_at(),
    )
    for table in TABLES:
        for statement in enable_auth_only(table):
            op.execute(statement)


def downgrade() -> None:
    for table in reversed(TABLES):
        for statement in disable_auth_only(table):
            op.execute(statement)
        op.drop_table(table)
