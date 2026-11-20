from enum import StrEnum

from sqlalchemy import Column, DateTime, Index, Integer, SmallInteger, String, Table, func

from parfocal_api.tables.base import one_of
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.db import metadata


class TimingEventName(StrEnum):
    TASK_FINISHED = "task_finished"
    AREA_TIME_RECORDED = "area_time_recorded"
    CELL_REVIEW_TIMED = "cell_review_timed"
    CHROME_COVERAGE_MEASURED = "chrome_coverage_measured"
    READING_TIME_COMPARED = "reading_time_compared"


timing_events = Table(
    "timing_events",
    metadata,
    *owned_ids(),
    Column("name", String(30), nullable=False, info=OPERATIONAL),
    Column("task_kind", String(20), nullable=True, info=OPERATIONAL),
    Column("area", String(20), nullable=True, info=OPERATIONAL),
    Column("duration_ms", Integer, nullable=True, info=OPERATIONAL),
    Column("estimated_ms", Integer, nullable=True, info=OPERATIONAL),
    Column("coverage_permille", SmallInteger, nullable=True, info=OPERATIONAL),
    Column(
        "recorded_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    one_of("name", TimingEventName),
    Index("ix_timing_events_tenant_id_recorded_at", "tenant_id", "recorded_at"),
)
