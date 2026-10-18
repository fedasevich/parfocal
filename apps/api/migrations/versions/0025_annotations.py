import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from geoalchemy2 import Geometry

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def tenant_column() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False, index=True
    )


def upgrade() -> None:
    op.create_unique_constraint("uq_slides_id_project_id", "slides", ["id", "project_id"])
    op.create_table(
        "slide_counters",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("slides.id"), primary_key=True),
        sa.Column("letter", sa.String(1), primary_key=True),
        sa.Column("last", sa.Integer, nullable=False),
        sa.CheckConstraint("letter IN ('T', 'C', 'R', 'Z', 'M')", name="letter"),
        sa.CheckConstraint("last >= 0", name="last"),
    )
    op.create_table(
        "annotations",
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        tenant_column(),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column[object]("geometry", Geometry(spatial_index=False), nullable=False),
        sa.Column("class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("slide_id", "kind", "number"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
        sa.ForeignKeyConstraint(
            ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
        ),
        sa.CheckConstraint("kind IN ('roi', 'measurement', 'region', 'cell')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint("version > 0", name="version"),
        sa.CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
    )
    op.create_index("ix_annotations_geometry", "annotations", ["geometry"], postgresql_using="gist")
    op.create_table(
        "annotation_versions",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column(
            "annotation_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("annotations.id"),
            primary_key=True,
        ),
        sa.Column("version", sa.Integer, primary_key=True),
        sa.Column("change", sa.String(20), nullable=False),
        sa.Column[object]("geometry", Geometry(spatial_index=False), nullable=False),
        sa.Column("class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column(
            "changed_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("change IN ('created', 'edited', 'deleted', 'restored')", name="change"),
    )
    for table in ("slide_counters", "annotations", "annotation_versions"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    for statement in track_updated_at("annotations"):
        op.execute(statement)
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON annotation_versions FROM {app_role()}")
    op.execute(f"REVOKE DELETE, TRUNCATE ON annotations FROM {app_role()}")


def downgrade() -> None:
    op.drop_table("annotation_versions")
    op.execute(untrack_updated_at("annotations")[0])
    op.drop_table("annotations")
    op.drop_table("slide_counters")
    op.drop_constraint("uq_slides_id_project_id", "slides", type_="unique")
