import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from parfocal_api.app import ParfocalApi, create_app
from parfocal_api.auth import authenticate
from parfocal_api.context import platform_connection
from parfocal_api.observability import (
    FRAMES_EVENT,
    JobRow,
    SyntheticError,
    job_recorder,
    run_alert_cycle,
)
from parfocal_api.openapi import PLACEHOLDER_SETTINGS
from parfocal_api.principals import PlatformOperator
from parfocal_common.alerting import INGEST_TIME, OnCall, SliName
from parfocal_common.clients import MemoryEmailSender, ProductionFactories
from parfocal_common.scrubbing import ALLOWED_FIELDS
from parfocal_common.sli_store import BATCH_PREFIX, AlertStateStore, MemoryBlobs

START = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
PAGES = "pages@example.test"


@dataclass
class FakeClock:
    now: datetime = START

    def __call__(self) -> datetime:
        return self.now


@dataclass
class Captured:
    errors: list[BaseException] = field(default_factory=list[BaseException])
    events: list[tuple[str, dict[str, str]]] = field(
        default_factory=list[tuple[str, dict[str, str]]]
    )

    def capture(self, error: BaseException) -> None:
        self.errors.append(error)

    def export(self, name: str, attributes: Mapping[str, str]) -> None:
        self.events.append((name, dict(attributes)))


@dataclass
class Rig:
    app: ParfocalApi
    client: TestClient
    clock: FakeClock
    blobs: MemoryBlobs
    captured: Captured


async def operator_connection() -> AsyncIterator[object]:
    yield object()


@pytest.fixture
def rig() -> Rig:
    captured = Captured()
    settings = PLACEHOLDER_SETTINGS.model_copy(
        update={"error_backend": "sentry", "telemetry_export": "otlp"}
    )
    app = create_app(
        settings,
        ProductionFactories(errors=lambda _: captured, telemetry=lambda _: captured),
    )
    clock = FakeClock()
    blobs = MemoryBlobs()
    app.state.sli.clock = clock
    app.state.sli.blobs = blobs
    app.dependency_overrides[authenticate] = lambda: PlatformOperator("operator")
    app.dependency_overrides[platform_connection] = operator_connection
    return Rig(app, TestClient(app, raise_server_exceptions=False), clock, blobs, captured)


def cold_cycle(blobs: MemoryBlobs, outbox: MemoryEmailSender, now: datetime) -> tuple[str, ...]:
    on_call = OnCall(outbox, PAGES, PAGES)
    return asyncio.run(run_alert_cycle(AlertStateStore(blobs), on_call, now)).firing


def subjects(outbox: MemoryEmailSender) -> list[str]:
    return [message.subject for message in outbox.sent]


def test_a_synthetic_error_reaches_error_reporting_and_pages_on_call(rig: Rig) -> None:
    for _ in range(3):
        response = rig.client.post("/api/platform/drills/synthetic-error")
        assert response.status_code == 500
    assert all(isinstance(error, SyntheticError) for error in rig.captured.errors)
    assert len(rig.captured.errors) == 3
    asyncio.run(rig.app.state.sli.flush())
    assert [key for key in rig.blobs.objects if key.startswith(BATCH_PREFIX)]

    outbox = MemoryEmailSender()
    firing = cold_cycle(rig.blobs, outbox, START + timedelta(minutes=1))
    assert "slo:availability:page" in firing
    assert subjects(outbox).count("[page] slo:availability:page") == 1

    cold_cycle(rig.blobs, outbox, START + timedelta(minutes=2))
    assert subjects(outbox).count("[page] slo:availability:page") == 1

    rig.clock.now = START + timedelta(hours=7)
    for _ in range(20):
        assert rig.client.get("/api/health").status_code == 200
    asyncio.run(rig.app.state.sli.flush())
    cold_cycle(rig.blobs, outbox, rig.clock.now + timedelta(minutes=1))
    assert "[resolved] slo:availability:page" in subjects(outbox)


def test_every_request_is_exported_with_allow_listed_keys_only(rig: Rig) -> None:
    rig.client.get("/api/health")
    [(name, attributes)] = [event for event in rig.captured.events if event[0].startswith("sli.")]
    assert name == SliName.AVAILABILITY.value
    assert attributes["route"] == "/api/health"
    assert attributes["ok"] == "true"
    assert set(attributes) <= ALLOWED_FIELDS


def test_the_drill_is_for_platform_operators_only(rig: Rig) -> None:
    del rig.app.dependency_overrides[platform_connection]
    rig.app.dependency_overrides[authenticate] = lambda: object()
    assert rig.client.post("/api/platform/drills/synthetic-error").status_code == 403
    assert rig.captured.errors == []


def test_viewer_frame_times_are_exported_as_numbers(rig: Rig) -> None:
    body = {"renderer": "viv", "frames": 240, "p50_ms": 16.6, "p95_ms": 41.2, "long_frames": 3}
    assert rig.client.post("/api/telemetry/frames", json=body).status_code == 204
    [(_, attributes)] = [event for event in rig.captured.events if event[0] == FRAMES_EVENT]
    assert attributes == {
        "renderer": "viv",
        "frames": "240",
        "p50_ms": "16.6",
        "p95_ms": "41.2",
        "long_frames": "3",
    }
    assert set(attributes) <= ALLOWED_FIELDS


@pytest.mark.parametrize(
    "body",
    [
        {"renderer": "viv", "frames": 0, "p50_ms": 1, "p95_ms": 1, "long_frames": 0},
        {"renderer": "viv", "frames": 5, "p50_ms": -1, "p95_ms": 1, "long_frames": 0},
        {"renderer": "other", "frames": 5, "p50_ms": 1, "p95_ms": 1, "long_frames": 0},
        {"renderer": "viv", "frames": 5, "p50_ms": 1, "p95_ms": 1, "long_frames": 0, "slide": "x"},
    ],
)
def test_frame_reports_outside_the_bounds_are_refused(rig: Rig, body: dict[str, object]) -> None:
    assert rig.client.post("/api/telemetry/frames", json=body).status_code == 422
    assert all(event[0] != FRAMES_EVENT for event in rig.captured.events)


def job(minutes_ago: int, status: str, took: int | None) -> Callable[[datetime], JobRow]:
    def build(now: datetime) -> JobRow:
        created = now - timedelta(minutes=minutes_ago)
        finished = None if took is None else created + timedelta(minutes=took)
        return JobRow("ingest", status, created, finished)

    return build


def test_stuck_and_failed_ingest_jobs_count_against_the_ingest_slo() -> None:
    now = START
    rows = [
        job(30, "running", None)(now),
        job(25, "queued", None)(now),
        job(40, "failed", 5)(now),
        job(50, "done", 3)(now),
        job(50, "paused", None)(now),
    ]
    tally = job_recorder(rows).tally(INGEST_TIME, now - timedelta(hours=1), now)
    assert (tally.total, tally.bad) == (4, 3)
