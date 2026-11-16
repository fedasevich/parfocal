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
    LargeBinary,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
    text,
)

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import case_timestamps, owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata, tenant_foreign_key, tenant_unique


class AnnotationKind(StrEnum):
    ROI = "roi"
    MEASUREMENT = "measurement"
    REGION = "region"
    CELL = "cell"
    ARROW = "arrow"
    TEXT = "text"


class AnnotationChange(StrEnum):
    CREATED = "created"
    EDITED = "edited"
    DELETED = "deleted"
    RESTORED = "restored"


class AnnotationOrigin(StrEnum):
    HUMAN = "human"
    AI_EDITED = "ai-edited"
    AI_CONFIRMED = "ai-confirmed"


slide_counters = Table(
    "slide_counters",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("letter", String(1), primary_key=True, info=OPERATIONAL),
    Column("last", Integer, nullable=False, info=OPERATIONAL),
    tenant_foreign_key("slide_id", "slides"),
    CheckConstraint("letter IN ('T', 'C', 'R', 'Z', 'M', 'A', 'N')", name="letter"),
    CheckConstraint("last >= 0", name="last"),
)

annotations = Table(
    "annotations",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("kind", String(20), nullable=False, info=OPERATIONAL),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column[object](
        "geometry",
        Geometry(spatial_index=False),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("text", String(200), nullable=True, info=PHI),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("version", Integer, nullable=False, server_default="1", info=OPERATIONAL),
    Column(
        "origin",
        String(16),
        nullable=False,
        server_default=AnnotationOrigin.HUMAN.value,
        info=OPERATIONAL,
    ),
    Column("source_number", Integer, nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *case_timestamps(),
    UniqueConstraint("slide_id", "kind", "number"),
    Index(
        "uq_annotations_source",
        "task_id",
        "slide_id",
        "kind",
        "source_number",
        unique=True,
        postgresql_where=text("source_number IS NOT NULL"),
    ),
    one_of("origin", AnnotationOrigin),
    CheckConstraint("(origin <> 'human') = (source_number IS NOT NULL)", name="source"),
    CheckConstraint("origin = 'human' OR task_id IS NOT NULL", name="source_task"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["slide_id", "project_id", "tenant_id"],
        ["slides.id", "slides.project_id", "slides.tenant_id"],
    ),
    ForeignKeyConstraint(
        ["class_id", "project_id", "tenant_id"],
        ["project_classes.id", "project_classes.project_id", "project_classes.tenant_id"],
    ),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "tenant_id"],
        [
            "review_task_slides.task_id",
            "review_task_slides.slide_id",
            "review_task_slides.tenant_id",
        ],
    ),
    tenant_unique(),
    Index("ix_annotations_geometry", "geometry", postgresql_using="gist"),
    one_of("kind", AnnotationKind),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint("version > 0", name="version"),
    CheckConstraint("ST_IsValid(geometry)", name="geometry_valid"),
    CheckConstraint("(kind = 'text') = (text IS NOT NULL)", name="text"),
)

annotation_versions = Table(
    "annotation_versions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("annotation_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("version", Integer, primary_key=True, info=OPERATIONAL),
    Column("change", String(20), nullable=False, info=OPERATIONAL),
    Column[object](
        "geometry",
        Geometry(spatial_index=False),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("text", String(200), nullable=True, info=PHI),
    Column(
        "changed_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "changed_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    tenant_foreign_key("annotation_id", "annotations"),
    one_of("change", AnnotationChange),
)

painted_maps = Table(
    "painted_maps",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("name", String(80), nullable=False, info=PHI),
    Column("version", Integer, nullable=False, server_default="1", info=OPERATIONAL),
    Column("cell", Integer, nullable=False, info=OPERATIONAL),
    Column("tile_cells", Integer, nullable=False, info=OPERATIONAL),
    Column("painted_cells", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("id", "tenant_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["slide_id", "project_id", "tenant_id"],
        ["slides.id", "slides.project_id", "slides.tenant_id"],
    ),
    CheckConstraint("version > 0", name="version"),
    CheckConstraint("cell > 0", name="cell"),
    CheckConstraint("tile_cells > 0", name="tile_cells"),
    CheckConstraint("painted_cells >= 0", name="painted_cells"),
)

painted_map_versions = Table(
    "painted_map_versions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("painted_map_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("version", Integer, primary_key=True, info=OPERATIONAL),
    Column("content", LargeBinary, nullable=False, info=OPERATIONAL),
    Column("painted_cells", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "saved_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "saved_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["painted_map_id", "tenant_id"], ["painted_maps.id", "painted_maps.tenant_id"]
    ),
    CheckConstraint("version > 0", name="version"),
)
