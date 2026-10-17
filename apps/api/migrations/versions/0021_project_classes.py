import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_classes",
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
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("key", sa.SmallInteger, nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("colour", sa.String(7), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("project_id", "key", deferrable=True, initially="DEFERRED"),
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("key BETWEEN 1 AND 9", name="key"),
        sa.CheckConstraint("colour ~ '^#[0-9a-f]{6}$'", name="colour"),
    )
    op.create_index(
        "ix_project_classes_project_id_name",
        "project_classes",
        ["project_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "class_mappings",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("source_name", sa.String(120), nullable=False),
        sa.Column("class_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("project_id", "source_name"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["class_id", "project_id"],
            ["project_classes.id", "project_classes.project_id"],
            ondelete="CASCADE",
        ),
    )
    for table in ("project_classes", "class_mappings"):
        for statement in [*enable_tenant_isolation(table), *track_updated_at(table)]:
            op.execute(statement)


def downgrade() -> None:
    for table in ("class_mappings", "project_classes"):
        op.execute(untrack_updated_at(table)[0])
        op.drop_table(table)
