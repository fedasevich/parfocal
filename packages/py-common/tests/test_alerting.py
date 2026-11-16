from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from parfocal_common.alerting import (
    AVAILABILITY,
    INGEST_TIME,
    PRE_READ_TIME,
    REALTIME,
    SLOS,
    TILE_LATENCY,
    Alert,
    Alerting,
    Instrument,
    OnCall,
    Pending,
    QuotaRule,
    Severity,
    SliName,
    SliRecorder,
    Slo,
    evaluate_slos,
    on_call_for,
    quota_alerts,
)
from parfocal_common.clients import (
    ConsoleErrorReporter,
    ConsoleTelemetryExporter,
    MemoryEmailSender,
    NoAnalytics,
    ProductionFactories,
    select_clients,
)
from parfocal_common.flags import RuleFlagClient
from parfocal_common.settings import AppEnv, ServiceSettings

START = datetime(2026, 11, 15, 8, 0, tzinfo=UTC)
PAGES = "pages@example.test"
TICKETS = "tickets@example.test"


@dataclass
class FakeClock:
    now: datetime = START

    def __call__(self) -> datetime:
        return self.now

    def advance(self, by: timedelta) -> None:
        self.now += by


class ServerError(Exception):
    pass


@dataclass
class FakeApi:
    instrument: Instrument
    fault: bool = False

    def request(self) -> int:
        status = 503 if self.fault else 200
        self.instrument.observe(SliName.AVAILABILITY, ok=status < 500)
        return status


@dataclass
class FakeRoomEdge:
    instrument: Instrument
    fault: bool = False

    def publish(self) -> None:
        self.instrument.observe(SliName.REALTIME, ok=not self.fault)


@dataclass
class FakeTileEdge:
    instrument: Instrument
    clock: FakeClock
    storage_delay: timedelta = timedelta(milliseconds=25)

    def fetch(self) -> bytes:
        with self.instrument.measure(SliName.TILE_LATENCY):
            self.clock.advance(self.storage_delay)
            return b"tile"


@dataclass
class FakeWorker:
    instrument: Instrument
    clock: FakeClock
    sli: SliName
    takes: timedelta | None
    running: list[tuple[datetime, Pending]] = field(default_factory=list[tuple[datetime, Pending]])

    def submit(self) -> None:
        self.finish_due()
        pending = self.instrument.start(self.sli)
        if self.takes is not None:
            self.running.append((self.clock.now + self.takes, pending))

    def finish_due(self) -> None:
        due = [item for item in self.running if item[0] <= self.clock.now]
        for item in due:
            self.running.remove(item)
            self.instrument.finish(item[1])


@dataclass
class Rig:
    clock: FakeClock = field(default_factory=FakeClock)
    recorder: SliRecorder = field(default_factory=SliRecorder)
    outbox: MemoryEmailSender = field(default_factory=MemoryEmailSender)

    def __post_init__(self) -> None:
        self.instrument = Instrument(self.recorder, self.clock)
        self.alerting = Alerting(OnCall(self.outbox, PAGES, TICKETS))

    def run(self, duration: timedelta, every: timedelta, work: Callable[[], object]) -> None:
        end = self.clock.now + duration
        next_check = self.clock.now + timedelta(minutes=5)
        while self.clock.now < end:
            work()
            self.clock.advance(every)
            if self.clock.now >= next_check:
                evaluate_slos(self.alerting, self.recorder, self.clock.now)
                next_check += timedelta(minutes=5)

    def subjects(self) -> list[str]:
        return [message.subject for message in self.outbox.sent]


@dataclass(frozen=True)
class Drill:
    slo: Slo
    every: timedelta
    build: Callable[[Rig], tuple[Callable[[], object], Callable[[], None], Callable[[], None]]]


def api_drill(rig: Rig) -> tuple[Callable[[], object], Callable[[], None], Callable[[], None]]:
    api = FakeApi(rig.instrument)

    def inject() -> None:
        api.fault = True

    def heal() -> None:
        api.fault = False

    return api.request, inject, heal


def tile_drill(rig: Rig) -> tuple[Callable[[], object], Callable[[], None], Callable[[], None]]:
    edge = FakeTileEdge(rig.instrument, rig.clock)

    def inject() -> None:
        edge.storage_delay = timedelta(milliseconds=400)

    def heal() -> None:
        edge.storage_delay = timedelta(milliseconds=25)

    return edge.fetch, inject, heal


def ingest_drill(rig: Rig) -> tuple[Callable[[], object], Callable[[], None], Callable[[], None]]:
    converter = FakeWorker(rig.instrument, rig.clock, SliName.INGEST_TIME, timedelta(minutes=3))

    def inject() -> None:
        converter.takes = timedelta(minutes=45)

    def heal() -> None:
        converter.takes = timedelta(minutes=3)

    return converter.submit, inject, heal


def pre_read_drill(
    rig: Rig,
) -> tuple[Callable[[], object], Callable[[], None], Callable[[], None]]:
    gpu_queue = FakeWorker(rig.instrument, rig.clock, SliName.PRE_READ_TIME, timedelta(minutes=25))

    def inject() -> None:
        gpu_queue.takes = None

    def heal() -> None:
        gpu_queue.takes = timedelta(minutes=25)

    return gpu_queue.submit, inject, heal


def realtime_drill(
    rig: Rig,
) -> tuple[Callable[[], object], Callable[[], None], Callable[[], None]]:
    edge = FakeRoomEdge(rig.instrument)

    def inject() -> None:
        edge.fault = True

    def heal() -> None:
        edge.fault = False

    return edge.publish, inject, heal


DRILLS = [
    Drill(AVAILABILITY, timedelta(seconds=10), api_drill),
    Drill(TILE_LATENCY, timedelta(seconds=5), tile_drill),
    Drill(INGEST_TIME, timedelta(minutes=2), ingest_drill),
    Drill(PRE_READ_TIME, timedelta(minutes=2), pre_read_drill),
    Drill(REALTIME, timedelta(seconds=10), realtime_drill),
]


def test_every_slo_has_a_fault_injection_drill() -> None:
    assert {drill.slo for drill in DRILLS} == set(SLOS)


@pytest.mark.parametrize("drill", DRILLS, ids=lambda drill: drill.slo.name)
def test_injected_fault_pages_on_call_and_recovery_resolves(drill: Drill) -> None:
    rig = Rig()
    work, inject, heal = drill.build(rig)
    page = f"[page] slo:{drill.slo.name}:page"
    phase = timedelta(hours=1) + (drill.slo.threshold or timedelta(0))

    rig.run(timedelta(hours=2), drill.every, work)
    assert rig.outbox.sent == []

    inject()
    rig.run(phase, drill.every, work)
    assert page in rig.subjects()
    fired = next(message for message in rig.outbox.sent if message.subject == page)
    assert fired.to == PAGES
    assert fired.template == "alert-firing"
    assert drill.slo.description in fired.text

    heal()
    rig.run(phase, drill.every, work)
    assert f"[resolved] slo:{drill.slo.name}:page" in rig.subjects()
    assert f"slo:{drill.slo.name}:page" not in rig.alerting.firing


@pytest.mark.parametrize("drill", DRILLS, ids=lambda drill: drill.slo.name)
def test_a_slow_burn_opens_a_ticket_without_paging(drill: Drill) -> None:
    rig = Rig()
    work, inject, heal = drill.build(rig)
    steps = 0
    one_bad_in = round(1 / (2 * drill.slo.error_budget))

    def mostly_healthy() -> object:
        nonlocal steps
        steps += 1
        if steps % one_bad_in == 0:
            inject()
        else:
            heal()
        return work()

    rig.run(timedelta(hours=8), drill.every, mostly_healthy)
    subjects = rig.subjects()
    assert f"[ticket] slo:{drill.slo.name}:ticket" in subjects
    assert all(not subject.startswith("[page]") for subject in subjects)
    assert all(message.to == TICKETS for message in rig.outbox.sent)


def test_work_that_never_finishes_pages_once_it_is_overdue() -> None:
    rig = Rig()
    stuck = FakeWorker(rig.instrument, rig.clock, SliName.INGEST_TIME, None)
    rig.run(timedelta(minutes=9), timedelta(minutes=1), stuck.submit)
    assert rig.outbox.sent == []
    assert rig.recorder.samples == {}
    rig.run(timedelta(minutes=15), timedelta(minutes=1), lambda: None)
    assert "[page] slo:ingest-time:page" in rig.subjects()


def test_a_single_slow_slide_at_pilot_volume_does_not_page() -> None:
    rig = Rig()
    worker = FakeWorker(rig.instrument, rig.clock, SliName.INGEST_TIME, timedelta(minutes=45))
    worker.submit()
    rig.run(timedelta(hours=1), timedelta(minutes=5), worker.finish_due)
    assert all(not subject.startswith("[page]") for subject in rig.subjects())


def test_an_alert_fires_once_while_it_stays_firing() -> None:
    rig = Rig()
    work, inject, _ = api_drill(rig)
    inject()
    rig.run(timedelta(hours=2), timedelta(seconds=10), work)
    assert rig.subjects().count("[page] slo:availability:page") == 1


def test_a_failed_operation_counts_against_the_slo_and_still_raises() -> None:
    rig = Rig()
    with pytest.raises(ServerError), rig.instrument.measure(SliName.TILE_LATENCY):
        raise ServerError
    [sample] = rig.recorder.samples[SliName.TILE_LATENCY]
    assert not sample.ok
    assert not TILE_LATENCY.is_good(sample)


@dataclass
class RecordingExporter:
    exported: list[tuple[str, dict[str, str]]] = field(
        default_factory=list[tuple[str, dict[str, str]]]
    )

    def export(self, name: str, attributes: Mapping[str, str]) -> None:
        self.exported.append((name, dict(attributes)))


def test_each_sample_is_exported_under_its_sli_name() -> None:
    exporter = RecordingExporter()
    clock = FakeClock()
    instrument = Instrument(SliRecorder(), clock, exporter)
    instrument.observe(SliName.INGEST_TIME, ok=True, duration=timedelta(minutes=3))
    assert exporter.exported == [("sli.ingest.slide", {"ok": "true", "duration_ms": "180000"})]


def test_quota_alerts_open_a_ticket_at_70_percent() -> None:
    rules = [QuotaRule("sentry-errors", 5000), QuotaRule("grafana-logs-gb", 50)]
    alerts = quota_alerts(rules, {"sentry-errors": 3600, "grafana-logs-gb": 10})
    assert [alert.key for alert in alerts] == ["quota:sentry-errors"]
    assert alerts[0].severity is Severity.TICKET


def test_alert_mail_carries_no_free_text_beyond_the_rule() -> None:
    outbox = MemoryEmailSender()
    on_call = OnCall(outbox, PAGES, TICKETS)
    on_call.fired(Alert("slo:availability:page", Severity.PAGE, "summary", {"slo": "availability"}))
    [message] = outbox.sent
    assert message.link.endswith("docs/compliance/incident-response.md")
    assert message.text == "summary"


def test_a_drill_switches_real_email_on_through_the_override_outside_production() -> None:
    delivered = MemoryEmailSender()
    settings = ServiceSettings(
        app_env=AppEnv.TEST,
        email_backend="resend",
        alert_page_email=PAGES,
        alert_ticket_email=TICKETS,
    )
    clients = select_clients(
        settings,
        ProductionFactories(
            email=lambda _: delivered,
            errors=lambda _: ConsoleErrorReporter(),
            telemetry=lambda _: ConsoleTelemetryExporter(),
            analytics=lambda _: NoAnalytics(),
            flags=lambda _: RuleFlagClient(),
        ),
    )
    rig = Rig(outbox=delivered)
    rig.alerting = Alerting(on_call_for(settings, clients))
    work, inject, _ = api_drill(rig)
    inject()
    rig.run(timedelta(hours=1), timedelta(seconds=10), work)
    assert [message.to for message in delivered.sent] == [PAGES, TICKETS]


def test_without_the_override_a_non_production_alert_stays_on_the_console() -> None:
    settings = ServiceSettings(app_env=AppEnv.DEV)
    clients = select_clients(settings, ProductionFactories())
    on_call = on_call_for(settings, clients)
    assert type(on_call.sender).__name__ == "ConsoleEmailSender"
    assert on_call.pages == "security@parfocal.eu"
