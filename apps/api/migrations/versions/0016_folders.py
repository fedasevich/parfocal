import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "folders",
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
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("colour", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "name"),
        sa.UniqueConstraint("id", "tenant_id"),
        sa.CheckConstraint("colour BETWEEN 0 AND 11", name="colour"),
    )
    op.create_table(
        "folder_members",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("folder_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.PrimaryKeyConstraint("folder_id", "user_id"),
        sa.ForeignKeyConstraint(["folder_id", "tenant_id"], ["folders.id", "folders.tenant_id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_folder_members_user_id", "folder_members", ["user_id"])
    op.add_column("cases", sa.Column("folder_id", sa.Uuid[uuid.UUID](), nullable=True))
    op.create_foreign_key(None, "cases", "folders", ["folder_id", "tenant_id"], ["id", "tenant_id"])
    op.create_index("ix_cases_folder_id", "cases", ["folder_id"])
    for statement in [
        *enable_tenant_isolation("folders"),
        *enable_tenant_isolation("folder_members"),
        *track_updated_at("folders"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_index("ix_cases_folder_id", "cases")
    op.drop_constraint("fk_cases_folder_id_tenant_id_folders", "cases", type_="foreignkey")
    op.drop_column("cases", "folder_id")
    op.execute(untrack_updated_at("folders")[0])
    op.drop_table("folder_members")
    op.drop_table("folders")
