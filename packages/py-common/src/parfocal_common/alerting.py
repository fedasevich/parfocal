from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from parfocal_common.clients import Clients, EmailMessage, EmailSender, TelemetryExporter
from parfocal_common.settings import ServiceSettings

type Clock = Callable[[], datetime]

RUNBOOK = "https://github.com/fedasevich/parfocal/blob/main/docs/compliance/incident-response.md"
SLO_WINDOW = timedelta(days=30)


class Severity(StrEnum):
    PAGE = "page"
    TICKET = "ticket"


class SliName(StrEnum):
    AVAILABILITY = "sli.api.request"
    TILE_LATENCY = "sli.tile.fetch"
    INGEST_TIME = "sli.ingest.slide"
    PRE_READ_TIME = "sli.pre-read.slide"


@dataclass(frozen=True)
class Slo:
    name: str
    sli: SliName
    objective: float
    description: str
    threshold: timedelta | None = None
    window: timedelta = SLO_WINDOW

    @property
    def error_budget(self) -> float:
        return 1 - self.objective

    def is_good(self, sample: Sample) -> bool:
        if not sample.ok:
            return False
        return self.threshold is None or sample.duration <= self.threshold


AVAILABILITY = Slo(
    "availability",
    SliName.AVAILABILITY,
    0.995,
    "99.5 percent of API requests end without a server error",
)
TILE_LATENCY = Slo(
    "tile-latency",
    SliName.TILE_LATENCY,
    0.95,
    "95 percent of tile fetches finish within 60 ms at the edge",
    threshold=timedelta(milliseconds=60),
)
INGEST_TIME = Slo(
    "ingest-time",
    SliName.INGEST_TIME,
    0.95,
    "95 percent of uploaded slides are ready to view within 10 minutes",
    threshold=timedelta(minutes=10),
)
PRE_READ_TIME = Slo(
    "pre-read-time",
    SliName.PRE_READ_TIME,
    0.95,
    "95 percent of AI pre-reads are ready within 60 minutes of the slide being ready",
    threshold=timedelta(minutes=60),
)
SLOS: tuple[Slo, ...] = (AVAILABILITY, TILE_LATENCY, INGEST_TIME, PRE_READ_TIME)


@dataclass(frozen=True)
class BurnRule:
    severity: Severity
    long: timedelta
    short: timedelta
    factor: float


BURN_RULES: tuple[BurnRule, ...] = (
    BurnRule(Severity.PAGE, timedelta(hours=1), timedelta(minutes=5), 14.4),
    BurnRule(Severity.PAGE, timedelta(hours=6), timedelta(minutes=30), 6.0),
    BurnRule(Severity.TICKET, timedelta(days=3), timedelta(hours=6), 1.0),
)


@dataclass(frozen=True)
class Sample:
    at: datetime
    ok: bool
    duration: timedelta = timedelta(0)


@dataclass(frozen=True)
class Alert:
    key: str
    severity: Severity
    summary: str
    labels: Mapping[str, str] = field(default_factory=dict[str, str])


@dataclass
class SliRecorder:
    samples: dict[SliName, list[Sample]] = field(default_factory=dict[SliName, list[Sample]])

    def record(self, sli: SliName, sample: Sample) -> None:
        self.samples.setdefault(sli, []).append(sample)

    def between(self, sli: SliName, start: datetime, end: datetime) -> list[Sample]:
        return [sample for sample in self.samples.get(sli, []) if start < sample.at <= end]


@dataclass
class Instrument:
    recorder: SliRecorder
    clock: Clock
    telemetry: TelemetryExporter | None = None

    def observe(self, sli: SliName, *, ok: bool, duration: timedelta = timedelta(0)) -> None:
        self.recorder.record(sli, Sample(self.clock(), ok, duration))
        if self.telemetry is not None:
            self.telemetry.export(
                sli.value,
                {
                    "ok": "true" if ok else "false",
                    "duration_ms": f"{duration.total_seconds() * 1000:.0f}",
                },
            )

    @contextmanager
    def measure(self, sli: SliName) -> Generator[None]:
        started = self.clock()
        try:
            yield
        except Exception:
            self.observe(sli, ok=False, duration=self.clock() - started)
            raise
        self.observe(sli, ok=True, duration=self.clock() - started)


def burn_rate(slo: Slo, samples: Sequence[Sample]) -> float:
    if not samples:
        return 0.0
    bad = sum(1 for sample in samples if not slo.is_good(sample))
    return (bad / len(samples)) / slo.error_budget


def slo_alerts(
    slo: Slo,
    recorder: SliRecorder,
    now: datetime,
    rules: Sequence[BurnRule] = BURN_RULES,
) -> list[Alert]:
    alerts: list[Alert] = []
    for severity in Severity:
        burning = [
            rule
            for rule in rules
            if rule.severity is severity
            and burn_rate(slo, recorder.between(slo.sli, now - rule.long, now)) >= rule.factor
            and burn_rate(slo, recorder.between(slo.sli, now - rule.short, now)) >= rule.factor
        ]
        if burning:
            rule = burning[0]
            alerts.append(
                Alert(
                    key=f"slo:{slo.name}:{severity.value}",
                    severity=severity,
                    summary=(
                        f"SLO {slo.name} burns its error budget at {rule.factor:g} times "
                        f"the sustainable rate over {rule.long} ({slo.description})"
                    ),
                    labels={"slo": slo.name},
                )
            )
    return alerts


@dataclass(frozen=True)
class QuotaRule:
    service: str
    limit: float
    share: float = 0.7


def quota_alerts(rules: Sequence[QuotaRule], usage: Mapping[str, float]) -> list[Alert]:
    return [
        Alert(
            key=f"quota:{rule.service}",
            severity=Severity.TICKET,
            summary=(
                f"{rule.service} used {usage[rule.service]:g} of {rule.limit:g} this month, "
                f"past {rule.share:.0%} of the free quota"
            ),
            labels={"service": rule.service},
        )
        for rule in rules
        if usage.get(rule.service, 0.0) >= rule.limit * rule.share
    ]


@dataclass(frozen=True)
class OnCall:
    sender: EmailSender
    pages: str
    tickets: str

    def address(self, severity: Severity) -> str:
        return self.pages if severity is Severity.PAGE else self.tickets

    def fired(self, alert: Alert) -> None:
        self.sender.send(
            EmailMessage(
                to=self.address(alert.severity),
                template="alert-firing",
                link=RUNBOOK,
                subject=f"[{alert.severity.value}] {alert.key}",
                text=alert.summary,
            )
        )

    def resolved(self, alert: Alert) -> None:
        self.sender.send(
            EmailMessage(
                to=self.address(alert.severity),
                template="alert-resolved",
                link=RUNBOOK,
                subject=f"[resolved] {alert.key}",
                text=alert.summary,
            )
        )


def on_call_for(settings: ServiceSettings, clients: Clients) -> OnCall:
    return OnCall(clients.email, settings.alert_page_email, settings.alert_ticket_email)


@dataclass
class Alerting:
    on_call: OnCall
    firing: dict[str, Alert] = field(default_factory=dict[str, Alert])

    def update(self, current: Sequence[Alert]) -> None:
        now_firing = {alert.key: alert for alert in current}
        for key, alert in now_firing.items():
            if key not in self.firing:
                self.on_call.fired(alert)
        for key, alert in self.firing.items():
            if key not in now_firing:
                self.on_call.resolved(alert)
        self.firing = now_firing


def evaluate_slos(
    alerting: Alerting,
    recorder: SliRecorder,
    now: datetime | None = None,
    slos: Sequence[Slo] = SLOS,
) -> None:
    moment = now or datetime.now(UTC)
    alerting.update([alert for slo in slos for alert in slo_alerts(slo, recorder, moment)])
