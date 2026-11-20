from datetime import datetime
from typing import Annotated, Literal, Self

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.settings_api import lab_of, personal_of
from parfocal_api.tables import TimingEventName, timing_events

TIMING_LIMIT = 5000
BATCH_LIMIT = 50
LONGEST_MS = 7 * 24 * 60 * 60 * 1000

type TimedTaskKind = Literal["review", "annotate", "upload", "report"]
type TimedArea = Literal["home", "cases", "search", "lab", "viewer", "reports", "admin", "account"]
type Milliseconds = Annotated[int, Field(ge=0, le=LONGEST_MS)]
type Permille = Annotated[int, Field(ge=0, le=1000)]

NEEDS: dict[TimingEventName, frozenset[str]] = {
    TimingEventName.TASK_FINISHED: frozenset({"task_kind", "duration_ms"}),
    TimingEventName.AREA_TIME_RECORDED: frozenset({"area", "duration_ms"}),
    TimingEventName.CELL_REVIEW_TIMED: frozenset({"duration_ms"}),
    TimingEventName.CHROME_COVERAGE_MEASURED: frozenset({"area", "coverage_permille"}),
    TimingEventName.READING_TIME_COMPARED: frozenset({"task_kind", "estimated_ms", "duration_ms"}),
}
FIELDS = ("task_kind", "area", "duration_ms", "estimated_ms", "coverage_permille")


class TimingEvent(BaseModel):
    name: TimingEventName
    task_kind: TimedTaskKind | None = None
    area: TimedArea | None = None
    duration_ms: Milliseconds | None = None
    estimated_ms: Milliseconds | None = None
    coverage_permille: Permille | None = None

    @model_validator(mode="after")
    def fits_its_name(self) -> Self:
        given = frozenset(field for field in FIELDS if getattr(self, field) is not None)
        if given != NEEDS[self.name]:
            raise ValueError(f"{self.name} takes exactly {', '.join(sorted(NEEDS[self.name]))}")
        return self


class TimingEventBatch(BaseModel):
    events: Annotated[list[TimingEvent], Field(min_length=1, max_length=BATCH_LIMIT)]


class TimingEventsRecorded(BaseModel):
    recorded: int


class RecordedTimingEvent(TimingEvent):
    recorded_at: datetime


class TaskTiming(BaseModel):
    events: list[RecordedTimingEvent]


me_router = APIRouter(prefix="/api/me", tags=["me"])
tenant_router = APIRouter(prefix="/api/tenant", tags=["tenant"])


async def analytics_allowed(connection: AsyncConnection, user_id: object) -> bool:
    policy = (await lab_of(connection)).values.get("analytics_policy", "person")
    if policy == "off":
        return False
    if policy == "on":
        return True
    return (await personal_of(connection, user_id)).get("analytics_opt_out") is not True


@me_router.post("/timing-events", operation_id="recordTimingEvents")
async def record_timing_events(
    batch: TimingEventBatch, principal: CurrentPrincipal, connection: TenantConnection
) -> TimingEventsRecorded:
    member = member_of(principal)
    if not await analytics_allowed(connection, member.user_id):
        return TimingEventsRecorded(recorded=0)
    await connection.execute(
        insert(timing_events),
        [
            {"tenant_id": member.tenant_id, **event.model_dump(), "name": event.name.value}
            for event in batch.events
        ],
    )
    return TimingEventsRecorded(recorded=len(batch.events))


@tenant_router.get(
    "/task-timing", operation_id="getTaskTiming", **require(Permission.WORKSPACE_SETTINGS)
)
async def get_task_timing(connection: TenantConnection) -> TaskTiming:
    rows = await connection.execute(
        select(timing_events)
        .order_by(timing_events.c.recorded_at.desc(), timing_events.c.id)
        .limit(TIMING_LIMIT)
    )
    return TaskTiming(
        events=[
            RecordedTimingEvent(
                name=TimingEventName(row.name),
                task_kind=row.task_kind,
                area=row.area,
                duration_ms=row.duration_ms,
                estimated_ms=row.estimated_ms,
                coverage_permille=row.coverage_permille,
                recorded_at=row.recorded_at,
            )
            for row in rows
        ]
    )
