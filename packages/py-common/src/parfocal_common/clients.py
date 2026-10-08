import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from parfocal_common.settings import ServiceSettings

logger = logging.getLogger("parfocal")


@dataclass(frozen=True)
class EmailMessage:
    to: str
    template: str
    link: str


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class ErrorReporter(Protocol):
    def capture(self, error: BaseException) -> None: ...


class TelemetryExporter(Protocol):
    def export(self, name: str, attributes: Mapping[str, str]) -> None: ...


class Analytics(Protocol):
    def capture(self, distinct_id: str, event: str, properties: Mapping[str, str]) -> None: ...


class FlagClient(Protocol):
    def variant(self, flag: str, distinct_id: str) -> str | None: ...


class ConsoleEmailSender:
    def send(self, message: EmailMessage) -> None:
        logger.info("email to=%s template=%s link=%s", message.to, message.template, message.link)


@dataclass
class MemoryEmailSender:
    sent: list[EmailMessage] = field(default_factory=list[EmailMessage])

    def send(self, message: EmailMessage) -> None:
        self.sent.append(message)


class ConsoleErrorReporter:
    def capture(self, error: BaseException) -> None:
        logger.error("unhandled error", exc_info=error)


class ConsoleTelemetryExporter:
    def export(self, name: str, attributes: Mapping[str, str]) -> None:
        logger.debug("telemetry %s %s", name, dict(attributes))


class NoAnalytics:
    def capture(self, distinct_id: str, event: str, properties: Mapping[str, str]) -> None:
        return None


@dataclass(frozen=True)
class FileFlagClient:
    defaults: Mapping[str, str]

    @classmethod
    def from_file(cls, path: Path) -> FileFlagClient:
        if not path.exists():
            return cls({})
        loaded: dict[str, str] = json.loads(path.read_text())
        return cls(loaded)

    def variant(self, flag: str, distinct_id: str) -> str | None:
        return self.defaults.get(flag)


type Factory[T] = Callable[[ServiceSettings], T]


@dataclass(frozen=True)
class ProductionFactories:
    email: Factory[EmailSender] | None = None
    errors: Factory[ErrorReporter] | None = None
    telemetry: Factory[TelemetryExporter] | None = None
    analytics: Factory[Analytics] | None = None
    flags: Factory[FlagClient] | None = None


@dataclass(frozen=True)
class Clients:
    email: EmailSender
    errors: ErrorReporter
    telemetry: TelemetryExporter
    analytics: Analytics
    flags: FlagClient


class MissingProductionClientError(RuntimeError):
    def __init__(self, concern: str, backend: str) -> None:
        super().__init__(f"{concern} backend '{backend}' is selected but no client is configured")


def _production[T](
    concern: str, backend: str, factory: Factory[T] | None, settings: ServiceSettings
) -> T:
    if factory is None:
        raise MissingProductionClientError(concern, backend)
    return factory(settings)


def select_clients(settings: ServiceSettings, production: ProductionFactories) -> Clients:
    backends = settings.backends()
    email: EmailSender
    match backends.email:
        case "resend":
            email = _production("email", "resend", production.email, settings)
        case "memory":
            email = MemoryEmailSender()
        case "console":
            email = ConsoleEmailSender()
    errors: ErrorReporter = (
        _production("errors", "sentry", production.errors, settings)
        if backends.errors == "sentry"
        else ConsoleErrorReporter()
    )
    telemetry: TelemetryExporter = (
        _production("telemetry", "otlp", production.telemetry, settings)
        if backends.telemetry == "otlp"
        else ConsoleTelemetryExporter()
    )
    analytics: Analytics = (
        _production("analytics", "posthog", production.analytics, settings)
        if backends.analytics == "posthog"
        else NoAnalytics()
    )
    flags: FlagClient = (
        _production("flags", "posthog", production.flags, settings)
        if backends.flags == "posthog"
        else FileFlagClient.from_file(Path(settings.flag_file))
    )
    return Clients(
        email=email, errors=errors, telemetry=telemetry, analytics=analytics, flags=flags
    )
