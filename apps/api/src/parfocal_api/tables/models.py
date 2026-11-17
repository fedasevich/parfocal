import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.model_catalogue import LicenceClass, ModelHost, ModelStatus
from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, SECRET
from parfocal_common.db import metadata, tenant_foreign_key, tenant_unique
from parfocal_common.model_runs import ModelTier


class TierTask(StrEnum):
    TUMOR = "tumor"
    OUTLINE = "outline"
    TYPER = "typer"


model_tiers = Table(
    "model_tiers",
    metadata,
    *owned_ids(),
    Column("task", String(10), nullable=False, info=OPERATIONAL),
    Column("tier", String(10), nullable=False, info=OPERATIONAL),
    Column("model_name", String(80), nullable=False, info=OPERATIONAL),
    Column("model_version", String(40), nullable=False, info=OPERATIONAL),
    Column(
        "set_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "task", "tier"),
    one_of("task", TierTask),
    one_of("tier", ModelTier),
)


hidden_models = Table(
    "hidden_models",
    metadata,
    *owned_ids(),
    Column("model_name", String(80), nullable=False, info=OPERATIONAL),
    Column(
        "hidden_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "model_name"),
)


class LabModelSignIn(StrEnum):
    NONE = "none"
    TOKEN = "token"
    HEADER = "header"


class ImportSourceKind(StrEnum):
    HTTPS = "https"
    STORAGE = "storage"


class LabModelRunners(StrEnum):
    ADMINS = "admins"
    RESEARCHERS = "researchers"


def licence_columns(nullable: bool) -> list[Column[Any]]:
    return [
        Column("licence_weights", String(400), nullable=nullable, info=OPERATIONAL),
        Column("licence_weights_class", String(20), nullable=nullable, info=OPERATIONAL),
        Column("licence_code", String(400), nullable=nullable, info=OPERATIONAL),
        Column("licence_data", JSONB, nullable=nullable, info=OPERATIONAL),
        Column("licence_source", String(400), nullable=nullable, info=OPERATIONAL),
        Column("licence_read_on", Date, nullable=nullable, info=OPERATIONAL),
    ]


registered_models = Table(
    "registered_models",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column("name", String(80), nullable=False, info=OPERATIONAL),
    Column("version", String(40), nullable=False, info=OPERATIONAL),
    Column("family", String(120), nullable=False, info=OPERATIONAL),
    Column("title", String(200), nullable=False, info=OPERATIONAL),
    Column("tasks", JSONB, nullable=False, info=OPERATIONAL),
    Column("makes", JSONB, nullable=False, info=OPERATIONAL),
    Column("host", String(20), nullable=False, info=OPERATIONAL),
    *licence_columns(nullable=False),
    Column("allowed_tenant_kinds", JSONB, nullable=False, info=OPERATIONAL),
    Column("input_mpp", Float[float](), nullable=True, info=OPERATIONAL),
    Column("status", String(20), nullable=False, info=OPERATIONAL),
    Column("evaluation_report", String(400), nullable=True, info=OPERATIONAL),
    Column("calibration_temperatures", JSONB, nullable=False, info=OPERATIONAL),
    Column("evaluation", JSONB, nullable=True, info=OPERATIONAL),
    Column("part_of_name", String(80), nullable=True, info=OPERATIONAL),
    Column("part_of_version", String(40), nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("name", "version"),
    ForeignKeyConstraint(
        ["part_of_name", "part_of_version"],
        ["registered_models.name", "registered_models.version"],
        name="fk_registered_models_part_of",
    ),
    CheckConstraint("(part_of_name IS NULL) = (part_of_version IS NULL)", name="part_of"),
    one_of("host", ModelHost),
    one_of("status", ModelStatus),
    one_of("licence_weights_class", LicenceClass),
)


maintenance = Table(
    "maintenance",
    metadata,
    Column("id", SmallInteger, primary_key=True, autoincrement=False, info=OPERATIONAL),
    Column("message", String(300), nullable=True, info=OPERATIONAL),
    Column("started_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("expected_end_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    *timestamps(),
    CheckConstraint("id = 1", name="single_row"),
    CheckConstraint("(message IS NULL) = (started_at IS NULL)", name="started_at"),
    CheckConstraint("expected_end_at IS NULL OR started_at IS NOT NULL", name="expected_end_at"),
)


lab_models = Table(
    "lab_models",
    metadata,
    *owned_ids(),
    Column("name", String(80), nullable=False, info=OPERATIONAL),
    Column("version", String(40), nullable=False, info=OPERATIONAL),
    *licence_columns(nullable=True),
    Column("address", String(2048), nullable=False, info=OPERATIONAL),
    Column("sign_in", String(10), nullable=False, info=OPERATIONAL),
    Column("header_name", String(80), nullable=True, info=OPERATIONAL),
    Column("secret_ciphertext", LargeBinary, nullable=True, info=SECRET),
    Column("secret_last_four", String(4), nullable=True, info=OPERATIONAL),
    Column("tile_size", Integer, nullable=False, info=OPERATIONAL),
    Column("magnification", Integer, nullable=False, info=OPERATIONAL),
    Column("taxonomy", String(40), nullable=False, info=OPERATIONAL),
    Column("class_map", JSONB, nullable=False, info=OPERATIONAL),
    Column("who_can_run", String(20), nullable=False, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "name", "version"),
    tenant_unique(),
    one_of("sign_in", LabModelSignIn),
    one_of("who_can_run", LabModelRunners),
)

lab_model_projects = Table(
    "lab_model_projects",
    metadata,
    Column("lab_model_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("tiles_confirmed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "tiles_confirmed_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    tenant_foreign_key("lab_model_id", "lab_models", ondelete="CASCADE"),
    tenant_foreign_key("project_id", "projects", ondelete="CASCADE"),
)

import_sources = Table(
    "import_sources",
    metadata,
    *owned_ids(),
    Column("name", String(80), nullable=False, info=OPERATIONAL),
    Column("kind", String(10), nullable=False, info=OPERATIONAL),
    Column("address", String(2048), nullable=False, info=OPERATIONAL),
    Column("region", String(40), nullable=True, info=OPERATIONAL),
    Column("header_name", String(80), nullable=True, info=OPERATIONAL),
    Column("credential_ciphertext", LargeBinary, nullable=True, info=SECRET),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    UniqueConstraint("tenant_id", "name"),
    tenant_unique(),
    one_of("kind", ImportSourceKind),
)

project_webhooks = Table(
    "project_webhooks",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, unique=True, info=OPERATIONAL),
    Column("hook_key", String(32), nullable=False, unique=True, info=OPERATIONAL),
    Column("secret_ciphertext", LargeBinary, nullable=False, info=SECRET),
    Column("old_secret_ciphertext", LargeBinary, nullable=True, info=SECRET),
    Column("rotated_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    tenant_foreign_key("project_id", "projects", ondelete="CASCADE"),
    tenant_unique(),
)

webhook_calls = Table(
    "webhook_calls",
    metadata,
    *owned_ids(),
    Column("webhook_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("idempotency_key", String(200), nullable=True, info=OPERATIONAL),
    Column("answer", JSONB, nullable=False, info=OPERATIONAL),
    Column("slide_upload_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("task_attached_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        info=OPERATIONAL,
    ),
    tenant_foreign_key("webhook_id", "project_webhooks", ondelete="CASCADE"),
    UniqueConstraint("webhook_id", "idempotency_key"),
)

rate_counters = Table(
    "rate_counters",
    metadata,
    Column("key", String(80), primary_key=True, info=PERSONAL),
    Column("window_start", DateTime(timezone=True), primary_key=True, info=OPERATIONAL),
    Column("count", Integer, nullable=False, info=OPERATIONAL),
    prefixes=["UNLOGGED"],
)
