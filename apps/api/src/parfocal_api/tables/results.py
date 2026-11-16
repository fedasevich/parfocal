import uuid
from enum import StrEnum

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY

from parfocal_api.tables.base import one_of
from parfocal_api.tables.cases import case_timestamps, owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata


class ResultSource(StrEnum):
    IMPORT = "import"
    RUN = "run"


class ResultStatus(StrEnum):
    IMPORTING = "importing"
    READY = "ready"
    FAILED = "failed"


class ResultObjectKind(StrEnum):
    REGION = "region"
    ZONE = "zone"


result_sets = Table(
    "result_sets",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("model_version", String(60), nullable=True, info=OPERATIONAL),
    Column("source", String(10), nullable=False, info=OPERATIONAL),
    Column("source_file", String(255), nullable=True, info=PHI),
    Column("produced_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "status",
        String(10),
        nullable=False,
        server_default=ResultStatus.IMPORTING.value,
        info=OPERATIONAL,
    ),
    Column("error_code", String(60), nullable=True, info=OPERATIONAL),
    Column("cell_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("region_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("zone_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *case_timestamps(),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(["job_id"], ["jobs.id"]),
    one_of("source", ResultSource),
    one_of("status", ResultStatus),
    CheckConstraint("cell_count >= 0 AND region_count >= 0 AND zone_count >= 0", name="counts"),
)

result_set_classes = Table(
    "result_set_classes",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("position", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("source_name", String(120), nullable=False, info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("object_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    UniqueConstraint("result_set_id", "source_name"),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
    ),
    ForeignKeyConstraint(
        ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    CheckConstraint("position BETWEEN 0 AND 254", name="position"),
    CheckConstraint("object_count >= 0", name="object_count"),
)

result_objects = Table(
    "result_objects",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column[object]("geometry", Geometry(spatial_index=False), nullable=False, info=OPERATIONAL),
    Column("class_index", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("score", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("probabilities", ARRAY(SmallInteger), nullable=True, info=OPERATIONAL),
    Column("parent_number", Integer, nullable=True, info=OPERATIONAL),
    ForeignKeyConstraint(["result_set_id"], ["result_sets.id"]),
    Index("ix_result_objects_geometry", "geometry", postgresql_using="gist"),
    one_of("kind", ResultObjectKind),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint("score BETWEEN 0 AND 255", name="score"),
    CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
)

result_chunks = Table(
    "result_chunks",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("chunk", Integer, primary_key=True, info=OPERATIONAL),
    Column("x", Integer, nullable=False, info=OPERATIONAL),
    Column("y", Integer, nullable=False, info=OPERATIONAL),
    Column("width", Integer, nullable=False, info=OPERATIONAL),
    Column("height", Integer, nullable=False, info=OPERATIONAL),
    Column("cell_count", Integer, nullable=False, info=OPERATIONAL),
    Column("vertex_count", Integer, nullable=False, info=OPERATIONAL),
    Column("object_key", String(300), nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["result_set_id"], ["result_sets.id"]),
    CheckConstraint("chunk >= 0", name="chunk"),
    CheckConstraint("width > 0 AND height > 0", name="size"),
    CheckConstraint("cell_count > 0 AND vertex_count >= 0", name="counts"),
)
