import uuid
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Table,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import PrivacyMode, owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata


class EmailDigest(StrEnum):
    OFF = "off"
    HOURLY = "hourly"
    DAILY = "daily"


class NotificationKind(StrEnum):
    MENTION = "mention"
    REPLY = "reply"
    TASK_ASSIGNED = "task-assigned"
    MODEL_RUN_FINISHED = "model-run-finished"
    MODEL_RUN_PAUSED = "model-run-paused"
    UPLOAD_DONE = "upload-done"
    UPLOAD_REFUSED = "upload-refused"
    DISAGREEMENTS_READY = "disagreements-ready"
    TASK_SIGNED_OFF = "task-signed-off"
    EMERGENCY_ACCESS = "emergency-access"
    TASK_DUE_SOON = "task-due-soon"
    TASK_NUDGED = "task-nudged"
    TASK_REASSIGNED = "task-reassigned"
    TASK_DUE_CHANGED = "task-due-changed"
    RESULT_SET_ADDED = "result-set-added"
    INTEGRATION_DOWN = "integration-down"
    ADJUDICATION_REQUESTED = "adjudication-requested"
    SLIDE_MOVED = "slide-moved"
    WORKSPACE_ACCESS_ASKED = "workspace-access-asked"
    TEMPLATE_OFFERED = "template-offered"


class EmailStatus(StrEnum):
    NONE = "none"
    PENDING = "pending"
    SENT = "sent"
    SKIPPED = "skipped"


notifications = Table(
    "notifications",
    metadata,
    *owned_ids(),
    Column("user_id", Uuid[uuid.UUID](), nullable=False, info=PERSONAL),
    Column("kind", String(30), nullable=False, info=OPERATIONAL),
    Column("target_type", String(30), nullable=False, info=OPERATIONAL),
    Column("target_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("payload", JSONB, nullable=False, server_default="{}", info=OPERATIONAL),
    Column("in_app", Boolean, nullable=False, info=OPERATIONAL),
    Column("realtime", Boolean, nullable=False, info=OPERATIONAL),
    Column("email_status", String(10), nullable=False, info=OPERATIONAL),
    Column("emailed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("read_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("project_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("muted", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("kind", NotificationKind),
    CheckConstraint("email_status IN ('none', 'pending', 'sent', 'skipped')", name="email"),
    Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
    Index(
        "ix_notifications_pending_email",
        "tenant_id",
        postgresql_where=text("email_status = 'pending'"),
    ),
    Index(
        "ix_notifications_user_id_unread",
        "user_id",
        "kind",
        postgresql_where=text("read_at IS NULL"),
    ),
)


class MuteSubject(StrEnum):
    PROJECT = "project"
    TASK = "task"
    CASE = "case"


notification_mutes = Table(
    "notification_mutes",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("subject", String(10), primary_key=True, info=OPERATIONAL),
    Column("subject_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("subject", MuteSubject),
)

personal_settings = Table(
    "personal_settings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("values", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=PERSONAL),
    Column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
)

workspace_settings = Table(
    "workspace_settings",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("values", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=OPERATIONAL),
    Column("locked", ARRAY(String(40)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("security_contact", String(320), nullable=True, info=PERSONAL),
    Column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
)

notification_preferences = Table(
    "notification_preferences",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(30), primary_key=True, info=OPERATIONAL),
    Column("in_app", Boolean, nullable=False, info=OPERATIONAL),
    Column("email", Boolean, nullable=False, info=OPERATIONAL),
    Column("realtime", Boolean, nullable=False, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"],
        ["memberships.tenant_id", "memberships.user_id"],
        ondelete="CASCADE",
    ),
    one_of("kind", NotificationKind),
)

case_requests = Table(
    "case_requests",
    metadata,
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), primary_key=True, info=PERSONAL),
    Column("request_key", String(100), primary_key=True, info=OPERATIONAL),
    Column("case_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
)


class AccessRequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"


workspace_access_requests = Table(
    "workspace_access_requests",
    metadata,
    *owned_ids(),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column(
        "status",
        String(10),
        nullable=False,
        server_default=AccessRequestStatus.PENDING.value,
        info=OPERATIONAL,
    ),
    Column(
        "asked_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("decided_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "decided_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    one_of("status", AccessRequestStatus),
    CheckConstraint("(status = 'pending') = (decided_at IS NULL)", name="decided_at"),
    Index(
        "ux_workspace_access_requests_pending",
        "tenant_id",
        "user_id",
        unique=True,
        postgresql_where=text("status = 'pending'"),
    ),
)


emergency_grants = Table(
    "emergency_grants",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), nullable=False, info=PERSONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column(
        "privacy_mode",
        String(20),
        nullable=False,
        server_default=PrivacyMode.CLINICAL.value,
        info=OPERATIONAL,
    ),
    Column("reason", String(500), nullable=False, info=PHI),
    Column(
        "granted_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["project_id", "privacy_mode", "tenant_id"],
        ["projects.id", "projects.privacy_mode", "projects.tenant_id"],
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
    ),
    Index("ix_emergency_grants_user_id_project_id", "user_id", "project_id"),
    CheckConstraint("privacy_mode = 'clinical'", name="clinical_only"),
)
