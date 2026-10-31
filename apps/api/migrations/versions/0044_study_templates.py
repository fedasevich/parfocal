import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_api.study_templates import built_in_rows
from parfocal_common.db import PLATFORM_OPERATOR, PLATFORM_SETTING
from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("study_templates", "study_template_versions")
BUILT_INS = (
    "built_in IN ('sentinel-node', 'detection', 'segmentation', 'cell-typing', 'reader-study')"
)
STUDY_KINDS = (
    "study_kind IN ('regions-and-cells', 'regions', 'outlines', 'cells', 'reviewers-first', "
    "'other')"
)
TASK_TEMPLATE_KEY = "fk_review_tasks_study_template_versions"
PLATFORM_SCOPE = f"SELECT set_config('{PLATFORM_SETTING}', 'on', true)"


def platform_seed(table: str) -> str:
    return f"CREATE POLICY platform_seed ON {table} FOR INSERT WITH CHECK ({PLATFORM_OPERATOR})"


def created_by() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
    )


def owned() -> list[sa.Column[uuid.UUID]]:
    return [
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
    ]


def seed_existing_workspaces() -> None:
    connection = op.get_bind()
    op.execute(PLATFORM_SCOPE)
    templates = sa.table(
        "study_templates",
        sa.column("id", sa.Uuid[uuid.UUID]()),
        sa.column("tenant_id", sa.Uuid[uuid.UUID]()),
        sa.column("built_in", sa.String()),
        sa.column("version", sa.SmallInteger()),
    )
    versions = sa.table(
        "study_template_versions",
        sa.column("tenant_id", sa.Uuid[uuid.UUID]()),
        sa.column("template_id", sa.Uuid[uuid.UUID]()),
        sa.column("version", sa.SmallInteger()),
        sa.column("name", sa.String()),
        sa.column("study_kind", sa.String()),
        sa.column("blocks", postgresql.JSONB()),
        sa.column("format", postgresql.JSONB()),
        sa.column("presets", postgresql.JSONB()),
    )
    for (tenant_id,) in connection.execute(sa.text("SELECT id FROM tenants")):
        template_rows, version_rows = built_in_rows(tenant_id)
        connection.execute(templates.insert(), template_rows)
        connection.execute(versions.insert(), version_rows)


def upgrade() -> None:
    op.create_table(
        "study_templates",
        *owned(),
        sa.Column("built_in", sa.String(20), nullable=True),
        sa.Column("version", sa.SmallInteger, nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        created_by(),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "built_in"),
        sa.UniqueConstraint("id", "tenant_id"),
        sa.CheckConstraint(BUILT_INS, name="built_in"),
        sa.CheckConstraint("version >= 1", name="version"),
    )
    op.create_table(
        "study_template_versions",
        *owned(),
        sa.Column("template_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("version", sa.SmallInteger, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("study_kind", sa.String(20), nullable=False),
        sa.Column("blocks", postgresql.JSONB, nullable=False),
        sa.Column("format", postgresql.JSONB, nullable=False),
        sa.Column("presets", postgresql.JSONB, nullable=False),
        created_by(),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("template_id", "version"),
        sa.UniqueConstraint("template_id", "version", "tenant_id"),
        sa.ForeignKeyConstraint(
            ["template_id", "tenant_id"],
            ["study_templates.id", "study_templates.tenant_id"],
            name="fk_study_template_versions_study_templates",
        ),
        sa.CheckConstraint(STUDY_KINDS, name="study_kind"),
        sa.CheckConstraint("version >= 1", name="version"),
    )
    for table in TABLES:
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
        op.execute(platform_seed(table))
    for statement in track_updated_at("study_templates"):
        op.execute(statement)
    op.add_column(
        "review_tasks", sa.Column("study_template_id", sa.Uuid[uuid.UUID](), nullable=True)
    )
    op.add_column(
        "review_tasks", sa.Column("study_template_version", sa.SmallInteger, nullable=True)
    )
    op.create_foreign_key(
        TASK_TEMPLATE_KEY,
        "review_tasks",
        "study_template_versions",
        ["study_template_id", "study_template_version", "tenant_id"],
        ["template_id", "version", "tenant_id"],
    )
    op.create_check_constraint(
        "study_template",
        "review_tasks",
        "(study_template_id IS NULL) = (study_template_version IS NULL)",
    )
    seed_existing_workspaces()


def downgrade() -> None:
    op.drop_constraint("study_template", "review_tasks", type_="check")
    op.drop_constraint(TASK_TEMPLATE_KEY, "review_tasks", type_="foreignkey")
    op.drop_column("review_tasks", "study_template_version")
    op.drop_column("review_tasks", "study_template_id")
    op.execute(untrack_updated_at("study_templates")[0])
    op.drop_table("study_template_versions")
    op.drop_table("study_templates")
