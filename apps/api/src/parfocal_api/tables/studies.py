import uuid
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL
from parfocal_common.db import metadata


class StudyKind(StrEnum):
    REGIONS_AND_CELLS = "regions-and-cells"
    REGIONS = "regions"
    OUTLINES = "outlines"
    CELLS = "cells"
    REVIEWERS_FIRST = "reviewers-first"
    OTHER = "other"


class BuiltInTemplate(StrEnum):
    SENTINEL_NODE = "sentinel-node"
    DETECTION = "detection"
    SEGMENTATION = "segmentation"
    CELL_TYPING = "cell-typing"
    READER_STUDY = "reader-study"


study_templates = Table(
    "study_templates",
    metadata,
    *owned_ids(),
    Column("built_in", String(20), nullable=True, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("retired_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "built_in"),
    UniqueConstraint("id", "tenant_id"),
    one_of("built_in", BuiltInTemplate),
    CheckConstraint("version >= 1", name="version"),
)

study_template_versions = Table(
    "study_template_versions",
    metadata,
    *owned_ids(),
    Column("template_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("study_kind", String(20), nullable=False, info=OPERATIONAL),
    Column("blocks", JSONB, nullable=False, info=OPERATIONAL),
    Column("format", JSONB, nullable=False, info=OPERATIONAL),
    Column("presets", JSONB, nullable=False, info=OPERATIONAL),
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
    UniqueConstraint("template_id", "version"),
    UniqueConstraint("template_id", "version", "tenant_id"),
    ForeignKeyConstraint(
        ["template_id", "tenant_id"],
        ["study_templates.id", "study_templates.tenant_id"],
        name="fk_study_template_versions_study_templates",
    ),
    one_of("study_kind", StudyKind),
    CheckConstraint("version >= 1", name="version"),
)


class TemplateOfferStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"


template_offers = Table(
    "template_offers",
    metadata,
    *owned_ids(),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column("study_kind", String(20), nullable=False, info=OPERATIONAL),
    Column("blocks", JSONB, nullable=False, info=OPERATIONAL),
    Column("format", JSONB, nullable=False, info=OPERATIONAL),
    Column("presets", JSONB, nullable=False, info=OPERATIONAL),
    Column(
        "offered_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=False,
        info=PERSONAL,
    ),
    Column(
        "status",
        String(10),
        nullable=False,
        server_default=TemplateOfferStatus.PENDING.value,
        info=OPERATIONAL,
    ),
    Column("template_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("decided_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "decided_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    one_of("status", TemplateOfferStatus),
    one_of("study_kind", StudyKind),
    CheckConstraint("(status = 'pending') = (decided_at IS NULL)", name="decided_at"),
)
