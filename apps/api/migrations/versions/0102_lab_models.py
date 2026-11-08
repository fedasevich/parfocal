import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0102"
down_revision: str | None = "0101"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lab_models",
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
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("address", sa.String(2048), nullable=False),
        sa.Column("sign_in", sa.String(10), nullable=False),
        sa.Column("header_name", sa.String(80), nullable=True),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("secret_last_four", sa.String(4), nullable=True),
        sa.Column("tile_size", sa.Integer(), nullable=False),
        sa.Column("magnification", sa.Integer(), nullable=False),
        sa.Column("taxonomy", sa.String(40), nullable=False),
        sa.Column("class_map", JSONB(), nullable=False),
        sa.Column("who_can_run", sa.String(20), nullable=False),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "name", "version"),
        sa.CheckConstraint("sign_in IN ('none', 'token', 'header')", name="sign_in"),
        sa.CheckConstraint("who_can_run IN ('admins', 'researchers')", name="who_can_run"),
    )
    op.create_table(
        "lab_model_projects",
        sa.Column(
            "lab_model_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("lab_models.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
    )
    for statement in [
        *enable_tenant_isolation("lab_models"),
        *track_updated_at("lab_models"),
        *enable_tenant_isolation("lab_model_projects"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("lab_model_projects")
    op.execute(untrack_updated_at("lab_models")[0])
    op.drop_table("lab_models")
