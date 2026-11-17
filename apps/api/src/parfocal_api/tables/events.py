import uuid
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, SECRET
from parfocal_common.db import metadata, tenant_foreign_key, tenant_unique


class EventKind(StrEnum):
    REVIEW_SUBMITTED = "review-submitted"
    TASK_DISAGREEMENTS = "task-disagreements"
    TASK_SIGNED_OFF = "task-signed-off"
    RESULT_SET_ADDED = "result-set-added"


class EventStatus(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


class AttemptOutcome(StrEnum):
    DELIVERED = "delivered"
    STATUS = "status"
    TIMEOUT = "timeout"
    UNREACHABLE = "unreachable"
    REFUSED = "refused"


event_targets = Table(
    "event_targets",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("address", String(2048), nullable=False, info=OPERATIONAL),
    Column("events", ARRAY(String(30)), nullable=False, info=OPERATIONAL),
    Column("secret_ciphertext", LargeBinary, nullable=False, info=SECRET),
    Column("failures_in_row", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("paused_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    tenant_unique(),
    tenant_foreign_key("project_id", "projects", ondelete="CASCADE"),
)

event_outbox = Table(
    "event_outbox",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("target_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("kind", String(30), nullable=False, info=OPERATIONAL),
    Column("sequence", BigInteger, Identity(), nullable=False, info=OPERATIONAL),
    Column("body", JSONB, nullable=False, info=OPERATIONAL),
    Column("status", String(10), nullable=False, server_default="pending", info=OPERATIONAL),
    Column("attempts", SmallInteger, nullable=False, server_default="0", info=OPERATIONAL),
    Column(
        "next_attempt_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("lease_until", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("delivered_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    tenant_unique(),
    tenant_foreign_key("target_id", "event_targets", ondelete="CASCADE"),
    one_of("kind", EventKind),
    one_of("status", EventStatus),
    Index("ix_event_outbox_status_next_attempt_at", "status", "next_attempt_at"),
)

event_attempts = Table(
    "event_attempts",
    metadata,
    *owned_ids(),
    Column("event_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("outcome", String(12), nullable=False, info=OPERATIONAL),
    Column("status_code", SmallInteger, nullable=True, info=OPERATIONAL),
    Column("duration_ms", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    tenant_foreign_key("event_id", "event_outbox", ondelete="CASCADE"),
    one_of("outcome", AttemptOutcome),
)
