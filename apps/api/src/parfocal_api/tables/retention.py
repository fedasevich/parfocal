import uuid
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata, tenant_foreign_key
from parfocal_common.pairing import Certainty, Rule
from parfocal_common.result_imports import ResultFormat, UploadKind

MIN_AUDIT_DAYS = 365

retention_policies = Table(
    "retention_policies",
    metadata,
    Column(
        "tenant_id", Uuid[uuid.UUID](), ForeignKey("tenants.id"), primary_key=True, info=OPERATIONAL
    ),
    Column("deleted_after_days", Integer, nullable=True, info=OPERATIONAL),
    Column("audit_after_days", Integer, nullable=True, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint("deleted_after_days >= 1", name="deleted_after_days"),
    CheckConstraint(f"audit_after_days >= {MIN_AUDIT_DAYS}", name="audit_after_days"),
)

legal_holds = Table(
    "legal_holds",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("reason", String(500), nullable=False, info=PERSONAL),
    Column(
        "placed_by_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL
    ),
    Column("released_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "released_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
)


class UploadStatus(StrEnum):
    OPEN = "open"
    COMPLETED = "completed"
    ABORTED = "aborted"
    EXPIRED = "expired"


MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_PARTS = 10_000

uploads = Table(
    "uploads",
    metadata,
    Column("id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "created_by_service_id",
        Uuid[uuid.UUID](),
        nullable=True,
        info=OPERATIONAL,
    ),
    tenant_foreign_key("created_by_service_id", "service_accounts"),
    Column("file_name", String(255), nullable=False, info=PHI),
    Column("size_bytes", BigInteger, nullable=False, info=OPERATIONAL),
    Column("last_modified_ms", BigInteger, nullable=True, info=OPERATIONAL),
    Column("object_key", String(512), nullable=False, unique=True, info=PHI),
    Column("storage_upload_id", String(1024), nullable=False, info=OPERATIONAL),
    Column("part_bytes", BigInteger, nullable=False, info=OPERATIONAL),
    Column("part_count", Integer, nullable=False, info=OPERATIONAL),
    Column("status", String(10), nullable=False, server_default="open", info=OPERATIONAL),
    Column("etag", String(80), nullable=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    tenant_foreign_key("job_id", "jobs"),
    Column(
        "last_activity_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("closed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("kind", String(10), nullable=False, server_default="slide", info=OPERATIONAL),
    Column("result_format", String(20), nullable=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("slide_upload_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("pairing_rule", String(30), nullable=True, info=OPERATIONAL),
    Column("pairing_certainty", String(10), nullable=True, info=OPERATIONAL),
    Column("result_set_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("import_problems", JSONB, nullable=True, info=OPERATIONAL),
    Column("import_choices", JSONB, nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("id", "project_id"),
    UniqueConstraint("result_set_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
    ForeignKeyConstraint(
        ["slide_id", "project_id"], ["slides.id", "slides.project_id"], use_alter=True
    ),
    ForeignKeyConstraint(["slide_upload_id", "project_id"], ["uploads.id", "uploads.project_id"]),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"],
        ["result_sets.id", "result_sets.project_id"],
        use_alter=True,
    ),
    one_of("status", UploadStatus),
    one_of("kind", UploadKind),
    one_of("result_format", ResultFormat),
    one_of("pairing_rule", Rule),
    one_of("pairing_certainty", Certainty),
    CheckConstraint(
        "kind = 'result' OR (result_format IS NULL AND slide_id IS NULL "
        "AND slide_upload_id IS NULL AND pairing_rule IS NULL AND result_set_id IS NULL)",
        name="slide_fields",
    ),
    CheckConstraint("(pairing_rule IS NULL) = (pairing_certainty IS NULL)", name="pairing"),
    CheckConstraint(
        "pairing_rule IS NULL OR slide_id IS NOT NULL OR slide_upload_id IS NOT NULL",
        name="paired_with",
    ),
    CheckConstraint("result_set_id IS NULL OR slide_id IS NOT NULL", name="imported_on_slide"),
    CheckConstraint("slide_upload_id IS NULL OR slide_upload_id <> id", name="not_itself"),
    CheckConstraint("size_bytes > 0", name="size_bytes"),
    CheckConstraint(f"part_bytes >= {MIN_UPLOAD_PART_BYTES}", name="part_bytes"),
    CheckConstraint(f"part_count BETWEEN 1 AND {MAX_UPLOAD_PARTS}", name="part_count"),
    CheckConstraint("(status = 'open') = (closed_at IS NULL)", name="closed"),
    CheckConstraint(
        "(created_by_user_id IS NULL) <> (created_by_service_id IS NULL)", name="created_by"
    ),
    CheckConstraint(
        "(job_id IS NULL OR status = 'completed') "
        "AND (kind = 'result' OR status <> 'completed' OR job_id IS NOT NULL)",
        name="completed_job",
    ),
    Index(
        "ix_uploads_slide_upload_id",
        "slide_upload_id",
        postgresql_where=text("slide_upload_id IS NOT NULL"),
    ),
    Index(
        "ix_uploads_open_by_file",
        "project_id",
        "file_name",
        "size_bytes",
        postgresql_where=text("status = 'open'"),
    ),
    Index(
        "ix_uploads_open_by_activity",
        "last_activity_at",
        postgresql_where=text("status = 'open'"),
    ),
)
