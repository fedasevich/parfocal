import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_api.tables.base import ProjectRole, SignOutRight, one_of, timestamps
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI, SECRET
from parfocal_common.db import metadata


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    UNKNOWN = "unknown"


class KeyPurpose(StrEnum):
    DATA = "data"
    INDEX = "index"


tenant_keys = Table(
    "tenant_keys",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("purpose", String(10), primary_key=True, info=OPERATIONAL),
    Column("version", Integer, primary_key=True, info=OPERATIONAL),
    Column("master_id", String(40), nullable=False, info=OPERATIONAL),
    Column("wrapped_key", LargeBinary, nullable=False, info=SECRET),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    one_of("purpose", KeyPurpose),
    CheckConstraint("version BETWEEN 1 AND 65535", name="version"),
)


class PrivacyMode(StrEnum):
    DE_IDENTIFIED = "de-identified"
    CLINICAL = "clinical"


class ClinicalTemplate(StrEnum):
    SENTINEL_NODE = "sentinel-node"
    LYMPH_NODE_EXCISION = "lymph-node-excision"


class AnalysisTemplate(StrEnum):
    NONE = "none"
    SENTINEL_NODE = "sentinel-node"
    CELL_REVIEW = "cell-review"


patients = Table(
    "patients",
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
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.CLINICAL.value,
        info=OPERATIONAL,
    ),
    Column("name_ciphertext", LargeBinary, nullable=False, info=PHI),
    Column("name_tokens", ARRAY(LargeBinary), nullable=False, info=PHI),
    Column("mrn_ciphertext", LargeBinary, nullable=True, info=PHI),
    Column("mrn_index", LargeBinary, nullable=True, info=PHI),
    Column("birth_date_ciphertext", LargeBinary, nullable=True, info=PHI),
    Column("birth_date_index", LargeBinary, nullable=True, info=PHI),
    Column("sex", String(10), nullable=False, server_default="unknown", info=PHI),
    Column("age_years", SmallInteger, nullable=True, info=PHI),
    *timestamps(),
    Column("deleted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    UniqueConstraint("project_id", "mrn_index"),
    Index("ix_patients_name_tokens", "name_tokens", postgresql_using="gin"),
    Index("ix_patients_birth_date_index", "project_id", "birth_date_index"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["project_id", "privacy_mode"], ["projects.id", "projects.privacy_mode"]),
    CheckConstraint("privacy_mode = 'clinical'", name="clinical_only"),
    one_of("sex", Sex),
    CheckConstraint("age_years BETWEEN 0 AND 150", name="age_years"),
)


class CaseSource(StrEnum):
    MANUAL = "manual"
    UPLOAD = "upload"
    IMPORT = "import"
    COPY = "copy"


class Laterality(StrEnum):
    LEFT = "left"
    RIGHT = "right"
    BILATERAL = "bilateral"
    NOT_APPLICABLE = "not-applicable"
    UNKNOWN = "unknown"


def owned_ids() -> list[Column[uuid.UUID]]:
    return [
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
    ]


def case_timestamps() -> list[Column[datetime]]:
    return [
        *timestamps(),
        Column("deleted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    ]


def case_column() -> Column[uuid.UUID]:
    return Column("case_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL)


projects = Table(
    "projects",
    metadata,
    *owned_ids(),
    Column("number", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column(
        "name_lower",
        Text,
        Computed("lower(name)", persisted=True),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.DE_IDENTIFIED.value,
        info=OPERATIONAL,
    ),
    *case_timestamps(),
    Column("colour", SmallInteger, nullable=False, server_default="0", info=OPERATIONAL),
    Column(
        "template",
        String(20),
        nullable=False,
        server_default=AnalysisTemplate.NONE.value,
        info=OPERATIONAL,
    ),
    Column("archived_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("sample", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column(
        "clinical_template",
        String(30),
        nullable=False,
        server_default=ClinicalTemplate.SENTINEL_NODE.value,
        info=OPERATIONAL,
    ),
    Column("blinded", Boolean, nullable=False, server_default=text("true"), info=OPERATIONAL),
    Column(
        "ai_hidden_first_read",
        Boolean,
        nullable=False,
        server_default=text("false"),
        info=OPERATIONAL,
    ),
    Column(
        "study_template_id",
        Uuid[uuid.UUID](),
        ForeignKey("study_templates.id"),
        nullable=True,
        info=OPERATIONAL,
    ),
    Column("match_iou", Float[float](), nullable=False, server_default="0.5", info=OPERATIONAL),
    Column(
        "match_distance_um", Float[float](), nullable=False, server_default="4", info=OPERATIONAL
    ),
    CheckConstraint("match_iou > 0 AND match_iou <= 1", name="match_iou"),
    CheckConstraint("match_distance_um > 0 AND match_distance_um <= 50", name="match_distance_um"),
    UniqueConstraint("tenant_id", "number"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "privacy_mode"),
    Index(
        "ix_projects_tenant_id_sample",
        "tenant_id",
        unique=True,
        postgresql_where=text("sample AND deleted_at IS NULL"),
    ),
    CheckConstraint("number BETWEEN 1 AND 9999", name="number"),
    CheckConstraint("colour BETWEEN 0 AND 11", name="colour"),
    one_of("privacy_mode", PrivacyMode),
    one_of("template", AnalysisTemplate),
    one_of("clinical_template", ClinicalTemplate),
)

project_members = Table(
    "project_members",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=PERSONAL),
    Column("role", String(10), nullable=False, info=OPERATIONAL),
    Column("sign_out", String(10), nullable=True, info=OPERATIONAL),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("role", ProjectRole),
    one_of("sign_out", SignOutRight),
)

cases = Table(
    "cases",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("patient_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("label", String(100), nullable=False, info=PHI),
    Column("label_lower", Text, Computed("lower(label)", persisted=True), nullable=False, info=PHI),
    Column("source", String(10), nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("clinical_note_ciphertext", LargeBinary, nullable=True, info=PHI),
    *case_timestamps(),
    UniqueConstraint("project_id", "label"),
    UniqueConstraint("id", "tenant_id"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["patient_id", "project_id"], ["patients.id", "patients.project_id"]),
    one_of("source", CaseSource),
)

specimens = Table(
    "specimens",
    metadata,
    *owned_ids(),
    case_column(),
    Column("letter", String(2), nullable=False, info=OPERATIONAL),
    Column("type", String(200), nullable=True, info=PHI),
    Column("site", String(200), nullable=True, info=PHI),
    Column(
        "laterality",
        String(20),
        nullable=False,
        server_default=Laterality.UNKNOWN.value,
        info=PHI,
    ),
    Column("procedure", String(200), nullable=True, info=PHI),
    Column("collected_at", DateTime(timezone=True), nullable=True, info=PHI),
    Column("received_at", DateTime(timezone=True), nullable=True, info=PHI),
    *case_timestamps(),
    UniqueConstraint("case_id", "letter"),
    UniqueConstraint("id", "case_id", "tenant_id"),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
    CheckConstraint("letter ~ '^[A-Z]{1,2}$'", name="letter"),
    one_of("laterality", Laterality),
)

blocks = Table(
    "blocks",
    metadata,
    *owned_ids(),
    case_column(),
    Column("specimen_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("number", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("description", String(200), nullable=True, info=PHI),
    Column("stains", ARRAY(String(60)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("levels", SmallInteger, nullable=False, server_default="1", info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("specimen_id", "number"),
    UniqueConstraint("id", "case_id"),
    ForeignKeyConstraint(
        ["specimen_id", "case_id", "tenant_id"],
        ["specimens.id", "specimens.case_id", "specimens.tenant_id"],
    ),
    CheckConstraint("number BETWEEN 1 AND 999", name="number"),
    CheckConstraint("levels BETWEEN 1 AND 50", name="levels"),
)

slides = Table(
    "slides",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("block_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("label", String(200), nullable=False, info=PHI),
    Column("label_lower", Text, Computed("lower(label)", persisted=True), nullable=False, info=PHI),
    Column("barcode", String(100), nullable=True, info=PHI),
    Column("stain", String(60), nullable=False, server_default="H&E", info=OPERATIONAL),
    Column("level", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("position", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("upload_id", Uuid[uuid.UUID](), nullable=True, unique=True, info=OPERATIONAL),
    Column("format", String(30), nullable=True, info=OPERATIONAL),
    Column("variant", String(30), nullable=True, info=OPERATIONAL),
    Column("reader", String(20), nullable=True, info=OPERATIONAL),
    Column("width", Integer, nullable=True, info=OPERATIONAL),
    Column("height", Integer, nullable=True, info=OPERATIONAL),
    Column("level_count", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("mpp_x", Float[float](), nullable=True, info=OPERATIONAL),
    Column("mpp_y", Float[float](), nullable=True, info=OPERATIONAL),
    Column("objective_power", Float[float](), nullable=True, info=OPERATIONAL),
    Column("notices", ARRAY(String(40)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("file_bytes", BigInteger, nullable=True, info=OPERATIONAL),
    Column("sha256", String(64), nullable=True, info=OPERATIONAL),
    Column("original_key", String(300), nullable=True, info=OPERATIONAL),
    Column(
        "restricted_images",
        ARRAY(String(10)),
        nullable=False,
        server_default="{}",
        info=OPERATIONAL,
    ),
    Column("published_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *case_timestamps(),
    UniqueConstraint("project_id", "barcode"),
    UniqueConstraint("id", "project_id"),
    Index(
        "ix_slides_case_id_label",
        "case_id",
        "label",
        unique=True,
        postgresql_where=text("deleted_at IS NULL"),
    ),
    Index(
        "ix_slides_project_id_label",
        "project_id",
        "label",
        unique=True,
        postgresql_where=text("case_id IS NULL AND deleted_at IS NULL"),
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
    ForeignKeyConstraint(["block_id", "case_id"], ["blocks.id", "blocks.case_id"]),
    ForeignKeyConstraint(["upload_id", "project_id"], ["uploads.id", "uploads.project_id"]),
    CheckConstraint("block_id IS NULL OR case_id IS NOT NULL", name="block_in_case"),
    CheckConstraint("upload_id IS NULL OR original_key IS NOT NULL", name="uploaded_file"),
)

project_classes = Table(
    "project_classes",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("key", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(60), nullable=False, info=OPERATIONAL),
    Column("colour", String(7), nullable=False, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("project_id", "key", deferrable=True, initially="DEFERRED"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("key BETWEEN 1 AND 9", name="key"),
    CheckConstraint("colour ~ '^#[0-9a-f]{6}$'", name="colour"),
    Index(
        "ix_project_classes_project_id_name", "project_id", func.lower(text("name")), unique=True
    ),
)

class_mappings = Table(
    "class_mappings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("source_name", String(120), primary_key=True, info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        ondelete="CASCADE",
    ),
)

opinion_forms = Table(
    "opinion_forms",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("questions", JSONB, nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    UniqueConstraint("project_id", "version"),
    UniqueConstraint("id", "project_id"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("version >= 1", name="version"),
)
