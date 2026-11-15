from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.db import PLATFORM_SETTING
from parfocal_common.schema_sql import (
    disable_platform_management,
    enable_platform_management,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0116"
down_revision: str | None = "0115"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "maintenance"
PLATFORM_SCOPE = f"SELECT set_config('{PLATFORM_SETTING}', 'on', true)"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.SmallInteger(), primary_key=True, autoincrement=False),
        sa.Column("message", sa.String(300), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expected_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("id = 1", name="single_row"),
        sa.CheckConstraint("(message IS NULL) = (started_at IS NULL)", name="started_at"),
        sa.CheckConstraint(
            "expected_end_at IS NULL OR started_at IS NOT NULL", name="expected_end_at"
        ),
    )
    for statement in enable_platform_management(TABLE, "true") + track_updated_at(TABLE):
        op.execute(statement)
    op.execute(PLATFORM_SCOPE)
    op.execute(f"INSERT INTO {TABLE} (id) VALUES (1)")


def downgrade() -> None:
    for statement in untrack_updated_at(TABLE) + disable_platform_management(TABLE):
        op.execute(statement)
    op.drop_table(TABLE)
