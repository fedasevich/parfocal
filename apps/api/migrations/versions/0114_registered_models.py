import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.model_registry import seed_rows
from parfocal_common.db import PLATFORM_SETTING
from parfocal_common.schema_sql import (
    disable_platform_management,
    enable_platform_management,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0114"
down_revision: str | None = "0113"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "registered_models"
PLATFORM_SCOPE = f"SELECT set_config('{PLATFORM_SETTING}', 'on', true)"
LICENCE_COLUMNS = (
    "licence_weights",
    "licence_weights_class",
    "licence_code",
    "licence_data",
    "licence_source",
    "licence_read_on",
)
JSON_COLUMNS = {
    "tasks",
    "makes",
    "licence_data",
    "allowed_tenant_kinds",
    "calibration_temperatures",
}


def licence_columns(nullable: bool) -> list[sa.Column[Any]]:
    return [
        sa.Column("licence_weights", sa.String(400), nullable=nullable),
        sa.Column("licence_weights_class", sa.String(20), nullable=nullable),
        sa.Column("licence_code", sa.String(400), nullable=nullable),
        sa.Column("licence_data", JSONB(), nullable=nullable),
        sa.Column("licence_source", sa.String(400), nullable=nullable),
        sa.Column("licence_read_on", sa.Date(), nullable=nullable),
    ]


def seed() -> None:
    op.execute(PLATFORM_SCOPE)
    rows = seed_rows()
    table = sa.table(
        TABLE,
        *(sa.column(name, JSONB() if name in JSON_COLUMNS else None) for name in rows[0]),
    )
    op.get_bind().execute(table.insert(), rows)


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("family", sa.String(120), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("tasks", JSONB(), nullable=False),
        sa.Column("makes", JSONB(), nullable=False),
        sa.Column("host", sa.String(20), nullable=False),
        *licence_columns(nullable=False),
        sa.Column("allowed_tenant_kinds", JSONB(), nullable=False),
        sa.Column("input_mpp", sa.Float[float](), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("evaluation_report", sa.String(400), nullable=True),
        sa.Column("calibration_temperatures", JSONB(), nullable=False),
        sa.Column("part_of_name", sa.String(80), nullable=True),
        sa.Column("part_of_version", sa.String(40), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("name", "version"),
        sa.ForeignKeyConstraint(
            ["part_of_name", "part_of_version"],
            [f"{TABLE}.name", f"{TABLE}.version"],
            name="fk_registered_models_part_of",
        ),
        sa.CheckConstraint("(part_of_name IS NULL) = (part_of_version IS NULL)", name="part_of"),
        sa.CheckConstraint("host IN ('parfocal', 'lab')", name="host"),
        sa.CheckConstraint("status IN ('candidate', 'validated', 'retired')", name="status"),
        sa.CheckConstraint(
            "licence_weights_class IN ('permitted', 'restricted', 'unconfirmed', 'own')",
            name="licence_weights_class",
        ),
    )
    for statement in enable_platform_management(TABLE, "true") + track_updated_at(TABLE):
        op.execute(statement)
    for column in licence_columns(nullable=True):
        op.add_column("lab_models", column)
    seed()


def downgrade() -> None:
    for name in reversed(LICENCE_COLUMNS):
        op.drop_column("lab_models", name)
    for statement in untrack_updated_at(TABLE) + disable_platform_management(TABLE):
        op.execute(statement)
    op.drop_table(TABLE)
