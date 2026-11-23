from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_api.tables.base import timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL
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
