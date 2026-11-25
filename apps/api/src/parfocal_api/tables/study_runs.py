import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, SECRET
from parfocal_common.db import metadata

study_sessions = Table(
    "study_sessions",
    metadata,
    *owned_ids(),
    Column("session_key", String(80), nullable=False, info=OPERATIONAL),
    Column("participant", String(40), nullable=False, info=PERSONAL),
    Column("round", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("answers", JSONB, nullable=False, info=PERSONAL),
    Column("dry_run", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("tenant_id", "session_key"),
)

study_trace_parts = Table(
    "study_trace_parts",
    metadata,
    *owned_ids(),
    Column("session_key", String(80), nullable=False, info=OPERATIONAL),
    Column("seq", BigInteger, nullable=False, info=OPERATIONAL),
    Column("body", LargeBinary, nullable=False, info=PERSONAL),
    Column("size", Integer, nullable=False, info=OPERATIONAL),
    *timestamps()[:1],
    UniqueConstraint("tenant_id", "session_key", "seq"),
)

study_links = Table(
    "study_links",
    metadata,
    *owned_ids(),
    Column("participant", String(40), nullable=False, info=PERSONAL),
    Column("token_hash", LargeBinary, nullable=False, unique=True, info=SECRET),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False, info=OPERATIONAL),
    Column("redeemed_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)
