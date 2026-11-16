import uuid
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import ClinicalTemplate, owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata


def task_owned_ids() -> list[Column[uuid.UUID]]:
    return [
        *owned_ids(),
        Column(
            "task_id",
            Uuid[uuid.UUID](),
            ForeignKey("review_tasks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
            info=OPERATIONAL,
        ),
    ]


def person_column(name: str) -> Column[uuid.UUID]:
    return Column(name, Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL)


evaluation_versions = Table(
    "evaluation_versions",
    metadata,
    *task_owned_ids(),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column("reason", String(500), nullable=True, info=PHI),
    person_column("started_by_user_id"),
    Column(
        "started_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("signed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    person_column("signed_by_user_id"),
    Column("confirmed_with", String(10), nullable=True, info=OPERATIONAL),
    Column("checksum", String(80), nullable=True, info=OPERATIONAL),
    Column("evaluation", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("blocks", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("format", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    UniqueConstraint("task_id", "number"),
    CheckConstraint("number >= 1", name="number"),
    CheckConstraint(
        "confirmed_with IS NULL OR confirmed_with IN ('sso', 'password')", name="confirmed_with"
    ),
    CheckConstraint("(signed_at IS NULL) = (checksum IS NULL)", name="signed"),
)

evaluation_changes = Table(
    "evaluation_changes",
    metadata,
    *task_owned_ids(),
    Column("version", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "slide_id", Uuid[uuid.UUID](), ForeignKey("slides.id"), nullable=False, info=OPERATIONAL
    ),
    Column("object_id", String(40), nullable=False, info=OPERATIONAL),
    Column("change", String(200), nullable=False, info=OPERATIONAL),
    Column("reason", String(500), nullable=False, info=PHI),
    person_column("changed_by_user_id"),
    Column(
        "changed_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)


class CaseReportState(StrEnum):
    DRAFT = "draft"
    SENT = "sent"
    RETURNED = "returned"
    SIGNED = "signed"
    AMENDED = "amended"


class NodeCategory(StrEnum):
    NONE = "none"
    ITC = "itc"
    MICRO = "micro"
    MACRO = "macro"


class Extranodal(StrEnum):
    PRESENT = "present"
    ABSENT = "absent"
    NOT_APPLICABLE = "na"


clinical_reports = Table(
    "clinical_reports",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=False, unique=True, info=OPERATIONAL),
    Column("template", String(30), nullable=False, info=OPERATIONAL),
    Column("template_version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("state", String(10), nullable=False, info=OPERATIONAL),
    Column("specimen", String(200), nullable=True, info=PHI),
    Column("category", String(10), nullable=True, info=OPERATIONAL),
    Column("confirmed_against", String(10), nullable=True, info=OPERATIONAL),
    Column("nodes_examined", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("extranodal", String(10), nullable=True, info=OPERATIONAL),
    Column("diagnosis", String(2000), nullable=True, info=PHI),
    Column("microscopic", String(5000), nullable=True, info=PHI),
    Column("comment", String(2000), nullable=True, info=PHI),
    person_column("cosigner_user_id"),
    person_column("sent_by_user_id"),
    Column("sent_content", JSONB(none_as_null=True), nullable=True, info=PHI),
    Column("sent_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("return_note", String(300), nullable=True, info=PHI),
    Column("version", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    person_column("created_by_user_id"),
    *timestamps(),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["case_id", "project_id"], ["cases.id", "cases.project_id"]),
    one_of("template", ClinicalTemplate),
    one_of("state", CaseReportState),
    one_of("category", NodeCategory),
    one_of("confirmed_against", NodeCategory),
    one_of("extranodal", Extranodal),
    CheckConstraint("template_version >= 1", name="template_version"),
    CheckConstraint("nodes_examined IS NULL OR nodes_examined >= 0", name="nodes_examined"),
    CheckConstraint("version >= 0", name="version"),
)

clinical_deposits = Table(
    "clinical_deposits",
    metadata,
    *owned_ids(),
    Column(
        "report_id",
        Uuid[uuid.UUID](),
        ForeignKey("clinical_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "slide_id", Uuid[uuid.UUID](), ForeignKey("slides.id"), nullable=False, info=OPERATIONAL
    ),
    Column("object_id", String(40), nullable=True, info=OPERATIONAL),
    Column("size_mm", Float[float](), nullable=True, info=OPERATIONAL),
    Column("note", String(300), nullable=True, info=PHI),
    *timestamps(),
    CheckConstraint("size_mm IS NULL OR size_mm > 0", name="size_mm"),
    CheckConstraint("object_id IS NOT NULL OR size_mm IS NOT NULL", name="source"),
)

clinical_report_versions = Table(
    "clinical_report_versions",
    metadata,
    *owned_ids(),
    Column(
        "report_id",
        Uuid[uuid.UUID](),
        ForeignKey("clinical_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column("content", JSONB(none_as_null=True), nullable=False, info=PHI),
    Column("reason", String(300), nullable=True, info=PHI),
    person_column("signed_by_user_id"),
    person_column("reported_by_user_id"),
    Column(
        "signed_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    UniqueConstraint("report_id", "number"),
    CheckConstraint("number >= 1", name="number"),
    CheckConstraint("(number = 1) = (reason IS NULL)", name="reason"),
)
