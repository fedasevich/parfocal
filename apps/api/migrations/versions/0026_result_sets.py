import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OUTPUT_TABLES = ("result_set_classes", "result_objects", "result_chunks")

WHILE_IMPORTING = """
CREATE FUNCTION parfocal_result_rows_while_importing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM result_sets WHERE id = NEW.result_set_id) IS DISTINCT FROM 'importing' THEN
    RAISE EXCEPTION 'result set % is not importing', NEW.result_set_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$
"""

CLASS_CHANGES = """
CREATE FUNCTION parfocal_result_class_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.result_set_id IS DISTINCT FROM OLD.result_set_id
     OR NEW.position IS DISTINCT FROM OLD.position
     OR NEW.source_name IS DISTINCT FROM OLD.source_name THEN
    RAISE EXCEPTION 'a result set class keeps its source name and position'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.object_count IS DISTINCT FROM OLD.object_count
     AND (SELECT status FROM result_sets WHERE id = NEW.result_set_id) <> 'importing' THEN
    RAISE EXCEPTION 'result set % is not importing', NEW.result_set_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$
"""

SET_CHANGES = """
CREATE FUNCTION parfocal_result_set_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'importing' AND (
       NEW.status, NEW.name, NEW.model_version, NEW.source, NEW.source_file, NEW.produced_at,
       NEW.error_code, NEW.cell_count, NEW.region_count, NEW.zone_count, NEW.job_id,
       NEW.slide_id, NEW.project_id, NEW.tenant_id, NEW.created_by_user_id, NEW.created_at
     ) IS DISTINCT FROM (
       OLD.status, OLD.name, OLD.model_version, OLD.source, OLD.source_file, OLD.produced_at,
       OLD.error_code, OLD.cell_count, OLD.region_count, OLD.zone_count, OLD.job_id,
       OLD.slide_id, OLD.project_id, OLD.tenant_id, OLD.created_by_user_id, OLD.created_at
     ) THEN
    RAISE EXCEPTION 'result set % is %, only deleting it is allowed', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$
"""


def app_role() -> str:
    return str(context.config.attributes.get("app_role", "parfocal_app"))


def tenant_column() -> sa.Column[uuid.UUID]:
    return sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True)


def upgrade() -> None:
    op.create_table(
        "result_sets",
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
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("model_version", sa.String(60), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("produced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="importing"),
        sa.Column("error_code", sa.String(60), nullable=True),
        sa.Column("cell_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("region_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("zone_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("job_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("jobs.id"), nullable=True),
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
        sa.UniqueConstraint("id", "project_id"),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
        sa.CheckConstraint("source IN ('import', 'run')", name="source"),
        sa.CheckConstraint("status IN ('importing', 'ready', 'failed')", name="status"),
        sa.CheckConstraint(
            "cell_count >= 0 AND region_count >= 0 AND zone_count >= 0", name="counts"
        ),
    )
    op.create_table(
        "result_set_classes",
        tenant_column(),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("result_set_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("position", sa.SmallInteger, primary_key=True),
        sa.Column("source_name", sa.String(120), nullable=False),
        sa.Column("class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("object_count", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("result_set_id", "source_name"),
        sa.ForeignKeyConstraint(
            ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
        ),
        sa.ForeignKeyConstraint(
            ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
        ),
        sa.CheckConstraint("position BETWEEN 0 AND 254", name="position"),
        sa.CheckConstraint("object_count >= 0", name="object_count"),
    )
    op.create_table(
        "result_objects",
        tenant_column(),
        sa.Column(
            "result_set_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("result_sets.id"),
            primary_key=True,
        ),
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.Column[object]("geometry", Geometry(spatial_index=False), nullable=False),
        sa.Column("class_index", sa.SmallInteger, nullable=True),
        sa.Column("score", sa.SmallInteger, nullable=True),
        sa.Column("probabilities", postgresql.ARRAY(sa.SmallInteger), nullable=True),
        sa.Column("parent_number", sa.Integer, nullable=True),
        sa.CheckConstraint("kind IN ('region', 'zone')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint("score BETWEEN 0 AND 255", name="score"),
        sa.CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
    )
    op.create_index(
        "ix_result_objects_geometry", "result_objects", ["geometry"], postgresql_using="gist"
    )
    op.create_table(
        "result_chunks",
        tenant_column(),
        sa.Column(
            "result_set_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("result_sets.id"),
            primary_key=True,
        ),
        sa.Column("chunk", sa.Integer, primary_key=True),
        sa.Column("x", sa.Integer, nullable=False),
        sa.Column("y", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("cell_count", sa.Integer, nullable=False),
        sa.Column("vertex_count", sa.Integer, nullable=False),
        sa.Column("object_key", sa.String(300), nullable=False),
        sa.CheckConstraint("chunk >= 0", name="chunk"),
        sa.CheckConstraint("width > 0 AND height > 0", name="size"),
        sa.CheckConstraint("cell_count > 0 AND vertex_count >= 0", name="counts"),
    )
    for table in ("result_sets", *OUTPUT_TABLES):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)
    for statement in track_updated_at("result_sets"):
        op.execute(statement)
    op.execute(WHILE_IMPORTING)
    op.execute(CLASS_CHANGES)
    op.execute(SET_CHANGES)
    for table in OUTPUT_TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_while_importing BEFORE INSERT ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION parfocal_result_rows_while_importing()"
        )
    op.execute(
        "CREATE TRIGGER result_set_classes_changes BEFORE UPDATE ON result_set_classes "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_result_class_changes()"
    )
    op.execute(
        "CREATE TRIGGER result_sets_changes BEFORE UPDATE ON result_sets "
        "FOR EACH ROW EXECUTE FUNCTION parfocal_result_set_changes()"
    )
    for table in ("result_objects", "result_chunks"):
        op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {table} FROM {app_role()}")
    for table in ("result_sets", "result_set_classes"):
        op.execute(f"REVOKE DELETE, TRUNCATE ON {table} FROM {app_role()}")


def downgrade() -> None:
    op.drop_table("result_chunks")
    op.drop_table("result_objects")
    op.drop_table("result_set_classes")
    op.execute(untrack_updated_at("result_sets")[0])
    op.drop_table("result_sets")
    for function in (
        "parfocal_result_set_changes",
        "parfocal_result_class_changes",
        "parfocal_result_rows_while_importing",
    ):
        op.execute(f"DROP FUNCTION {function}()")
