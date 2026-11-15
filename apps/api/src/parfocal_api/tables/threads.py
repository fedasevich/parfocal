import uuid
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    String,
    Table,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI, SECRET
from parfocal_common.db import metadata, tenant_foreign_key, tenant_unique


class AnchorKind(StrEnum):
    OBJECT = "object"
    ROI = "roi"
    POINT = "point"
    SHAPE = "shape"


threads = Table(
    "threads",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("title", String(120), nullable=False, info=PHI),
    Column("anchor_kind", String(10), nullable=False, info=OPERATIONAL),
    Column("object_id", String(30), nullable=True, info=OPERATIONAL),
    Column("geometry", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("offset_x", Float[float](), nullable=True, info=OPERATIONAL),
    Column("offset_y", Float[float](), nullable=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=False,
        info=PERSONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("resolved_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "resolved_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    tenant_foreign_key("result_set_id", "result_sets"),
    tenant_unique(),
    Index("ix_threads_task_id_slide_id", "task_id", "slide_id"),
    Index(
        "ix_threads_project_id_slide_id_taskless",
        "project_id",
        "slide_id",
        postgresql_where=text("task_id IS NULL"),
    ),
    one_of("anchor_kind", AnchorKind),
    CheckConstraint(
        "(anchor_kind IN ('object', 'roi')) = (object_id IS NOT NULL)", name="object_anchor"
    ),
    CheckConstraint(
        "(anchor_kind IN ('point', 'shape')) = (geometry IS NOT NULL)", name="geometry_anchor"
    ),
    CheckConstraint("(offset_x IS NULL) = (offset_y IS NULL)", name="offset"),
    CheckConstraint("(resolved_at IS NULL) = (resolved_by_user_id IS NULL)", name="resolved"),
)

thread_messages = Table(
    "thread_messages",
    metadata,
    *owned_ids(),
    Column(
        "thread_id",
        Uuid[uuid.UUID](),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("thread_id", "threads", ondelete="CASCADE"),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column("body", String(4000), nullable=False, info=PHI),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)

slide_coverage = Table(
    "slide_coverage",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column(
        "slide_id",
        Uuid[uuid.UUID](),
        primary_key=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("slide_id", "slides", ondelete="CASCADE"),
    Column(
        "user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        info=PERSONAL,
    ),
    Column("cell", Integer, nullable=False, info=OPERATIONAL),
    Column("columns", Integer, nullable=False, info=OPERATIONAL),
    Column("rows", Integer, nullable=False, info=OPERATIONAL),
    Column("seen", LargeBinary, nullable=False, info=PERSONAL),
    Column("seen_cells", Integer, nullable=False, info=PERSONAL),
    *timestamps(),
)


class ResumeMode(StrEnum):
    GUIDED = "guided"
    VIEWER = "viewer"


resume_states = Table(
    "resume_states",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        nullable=False,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("task_id", "review_tasks", ondelete="CASCADE"),
    Column(
        "slide_id",
        Uuid[uuid.UUID](),
        nullable=False,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("slide_id", "slides", ondelete="CASCADE"),
    Column("mode", String(10), nullable=False, info=PERSONAL),
    Column("object_id", String(40), nullable=True, info=PERSONAL),
    Column("camera", JSONB(none_as_null=True), nullable=True, info=PERSONAL),
    *timestamps(),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("mode", ResumeMode),
)


report_links = Table(
    "report_links",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("task_id", "review_tasks", ondelete="CASCADE"),
    Column("token_hash", LargeBinary, nullable=False, unique=True, info=SECRET),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("revoked_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("opened_count", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("last_opened_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)
