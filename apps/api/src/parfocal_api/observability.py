import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from parfocal_api.context import CurrentPrincipal, PlatformConnection
from parfocal_api.request_logging import route_of
from parfocal_api.security_alerts import CrossWorkspaceWatch, workspaces
from parfocal_common.alerting import (
    SLOS,
    Alerting,
    OnCall,
    Sample,
    SliName,
    SliRecorder,
    SliSource,
    evaluate_slos,
)
from parfocal_common.clients import Clients, TelemetryExporter
from parfocal_common.db import tenant_transaction
from parfocal_common.job_sli import JOB_SLIS, counts_toward_an_slo, jobs_with_runs
from parfocal_common.jobs import jobs
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import AppEnv, ServiceSettings
from parfocal_common.sli_store import (
    FRAMES_EVENT,
    SLO_STATUS_EVENT,
    AlertStateStore,
    CombinedSource,
    ObjectBlobs,
    SliEmitter,
)

STATUS_WINDOW = timedelta(hours=1)
OPEN_STATUSES = ("queued", "running")
FINISHED_STATUSES = ("done", "failed")


def sli_emitter(settings: ServiceSettings, clients: Clients, storage: ObjectStore) -> SliEmitter:
    blobs = None if settings.app_env is AppEnv.TEST else ObjectBlobs(storage)
    return SliEmitter(lambda: datetime.now(UTC), blobs, clients.telemetry)


class SliMiddleware:
    def __init__(self, app: ASGIApp, emitter: SliEmitter) -> None:
        self.app = app
        self.emitter = emitter

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def send_with_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_with_status)
        finally:
            self.emitter.observe(
                SliName.AVAILABILITY,
                ok=status < 500,
                duration=timedelta(seconds=time.perf_counter() - started),
                attributes={"route": route_of(scope), "status_code": str(status)},
            )
            await self.emitter.flush_if_due()


@dataclass(frozen=True)
class JobRow:
    kind: str
    status: str
    created_at: datetime
    finished_at: datetime | None


def job_recorder(rows: Sequence[JobRow]) -> SliRecorder:
    recorder = SliRecorder()
    for row in rows:
        sli = JOB_SLIS[row.kind]
        if row.finished_at is None:
            if row.status in OPEN_STATUSES:
                recorder.start(sli, row.created_at)
            continue
        if row.status in FINISHED_STATUSES:
            recorder.record(
                sli,
                Sample(row.finished_at, row.status == "done", row.finished_at - row.created_at),
            )
    return recorder


async def job_rows(engine: AsyncEngine) -> list[JobRow]:
    rows: list[JobRow] = []
    for tenant_id in await workspaces(engine):
        async with tenant_transaction(engine, tenant_id) as connection:
            result = await connection.execute(
                select(jobs.c.kind, jobs.c.status, jobs.c.created_at, jobs.c.finished_at)
                .select_from(jobs_with_runs())
                .where(
                    jobs.c.tenant_id == tenant_id,
                    jobs.c.kind.in_(JOB_SLIS),
                    jobs.c.finished_at.is_(None),
                    jobs.c.status.in_(OPEN_STATUSES),
                    counts_toward_an_slo(),
                )
            )
            rows.extend(
                JobRow(row.kind, row.status, row.created_at, row.finished_at) for row in result
            )
    return rows


def export_slo_status(telemetry: TelemetryExporter, source: SliSource, now: datetime) -> None:
    for slo in SLOS:
        tally = source.tally(slo, now - STATUS_WINDOW, now)
        good = 1000 if tally.total == 0 else round(1000 * (tally.total - tally.bad) / tally.total)
        telemetry.export(
            SLO_STATUS_EVENT,
            {
                "slo": slo.name,
                "count": str(tally.total),
                "good_permille": str(good),
                "burn_tenths": str(round(10 * tally.burn_rate(slo))),
            },
        )


@dataclass(frozen=True)
class CycleResult:
    firing: tuple[str, ...]
    crossings: int


async def run_alert_cycle(
    store: AlertStateStore,
    on_call: OnCall,
    now: datetime,
    engine: AsyncEngine | None = None,
    telemetry: TelemetryExporter | None = None,
) -> CycleResult:
    state = await store.load()
    folded = await store.fold(state, now)
    alerting = Alerting(on_call, dict(state.firing))
    rows = [] if engine is None else await job_rows(engine)
    source = CombinedSource((state.counts, job_recorder(rows)))
    evaluate_slos(alerting, source, now)
    if telemetry is not None:
        export_slo_status(telemetry, source, now)
    state.firing = alerting.firing
    crossings = 0
    if engine is not None:
        watch = CrossWorkspaceWatch(engine, on_call, dict(state.watermarks))
        crossings = len(await watch.check())
        state.watermarks = watch.watermarks
    await store.save(state, folded)
    return CycleResult(tuple(sorted(state.firing)), crossings)


class SyntheticError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("synthetic error raised by an operator drill")


drill_router = APIRouter(prefix="/api/platform/drills", tags=["platform"])


@drill_router.post("/synthetic-error", status_code=204, operation_id="raiseSyntheticError")
async def raise_synthetic_error(_: CurrentPrincipal, __: PlatformConnection) -> None:
    raise SyntheticError


type FrameMs = Annotated[float, Field(ge=0, le=60_000)]


class FrameSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    renderer: Literal["viv", "deck-webgpu", "custom-webgpu"]
    frames: Annotated[int, Field(ge=1, le=1_000_000)]
    p50_ms: FrameMs
    p95_ms: FrameMs
    long_frames: Annotated[int, Field(ge=0, le=1_000_000)]


def export_frames(telemetry: TelemetryExporter, summary: FrameSummary) -> None:
    telemetry.export(
        FRAMES_EVENT,
        {
            "renderer": summary.renderer,
            "frames": str(summary.frames),
            "p50_ms": f"{summary.p50_ms:.1f}",
            "p95_ms": f"{summary.p95_ms:.1f}",
            "long_frames": str(min(summary.long_frames, summary.frames)),
        },
    )


rum_router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@rum_router.post("/frames", status_code=204, operation_id="reportViewerFrames")
async def report_viewer_frames(
    summary: FrameSummary, request: Request, _: CurrentPrincipal
) -> None:
    export_frames(request.app.clients.telemetry, summary)
