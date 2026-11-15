import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import httpx2

from parfocal_common.scrubbing import SensitiveValues, scrub_attributes
from parfocal_common.settings import ServiceSettings
from parfocal_common.structured_logging import ContextSensitiveValues

LOGS_PATH = "/v1/logs"
MAX_BUFFERED = 5_000

logger = logging.getLogger("parfocal.telemetry")


@runtime_checkable
class FlushingExporter(Protocol):
    async def flush(self) -> None: ...


class MissingOtlpEndpointError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("TELEMETRY_EXPORT=otlp needs OTLP_ENDPOINT and OTLP_HEADERS")


def parse_headers(raw: str) -> dict[str, str]:
    pairs = [item.split("=", 1) for item in raw.split(",") if "=" in item]
    return {name.strip(): value.strip() for name, value in pairs}


def any_value(value: str) -> dict[str, str]:
    return {"stringValue": value}


@dataclass
class OtlpLogExporter:
    endpoint: str
    headers: Mapping[str, str]
    http: httpx2.AsyncClient
    service: str
    environment: str
    clock_ns: Callable[[], int] = time.time_ns
    sensitive: SensitiveValues = field(default_factory=ContextSensitiveValues)
    records: list[dict[str, object]] = field(default_factory=list[dict[str, object]])

    def export(self, name: str, attributes: Mapping[str, str]) -> None:
        if len(self.records) >= MAX_BUFFERED:
            return
        scrubbed = scrub_attributes({"event": name, **attributes}, self.sensitive)
        self.records.append(
            {
                "timeUnixNano": str(self.clock_ns()),
                "severityText": "INFO",
                "body": any_value(name),
                "attributes": [
                    {"key": key, "value": any_value(str(value))} for key, value in scrubbed.items()
                ],
            }
        )

    def payload(self, records: list[dict[str, object]]) -> dict[str, object]:
        return {
            "resourceLogs": [
                {
                    "resource": {
                        "attributes": [
                            {"key": "service.name", "value": any_value(self.service)},
                            {
                                "key": "deployment.environment",
                                "value": any_value(self.environment),
                            },
                        ]
                    },
                    "scopeLogs": [{"scope": {"name": "parfocal"}, "logRecords": records}],
                }
            ]
        }

    async def flush(self) -> None:
        if not self.records:
            return
        records, self.records = self.records, []
        try:
            response = await self.http.post(
                f"{self.endpoint.rstrip('/')}{LOGS_PATH}",
                json=self.payload(records),
                headers=dict(self.headers),
            )
            response.raise_for_status()
        except httpx2.HTTPError as error:
            logger.warning("telemetry not exported", extra={"error_type": type(error).__name__})


def otlp_exporter(settings: ServiceSettings, service: str = "api") -> OtlpLogExporter:
    if settings.otlp_endpoint is None or settings.otlp_headers is None:
        raise MissingOtlpEndpointError
    return OtlpLogExporter(
        endpoint=settings.otlp_endpoint,
        headers=parse_headers(settings.otlp_headers.get_secret_value()),
        http=httpx2.AsyncClient(timeout=5),
        service=service,
        environment=settings.app_env.value,
    )
