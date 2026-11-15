import asyncio
import json
from datetime import UTC, datetime
from typing import Any, cast

import httpx2
import pytest

from parfocal_common.alerting import SliName
from parfocal_common.clients import ProductionFactories, select_clients
from parfocal_common.otlp import (
    MissingOtlpEndpointError,
    OtlpLogExporter,
    otlp_exporter,
    parse_headers,
)
from parfocal_common.scrubbing import REDACTED, SensitiveValues
from parfocal_common.settings import AppEnv, ServiceSettings
from parfocal_common.sli_store import MemoryBlobs, SliEmitter

PATIENT_NAME = "Testa Examplova"


class Collector:
    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.requests: list[httpx2.Request] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return httpx2.Response(self.status)

    def records(self) -> list[dict[str, object]]:
        body = json.loads(self.requests[-1].content)
        return body["resourceLogs"][0]["scopeLogs"][0]["logRecords"]


def exporter(collector: Collector, sensitive: SensitiveValues | None = None) -> OtlpLogExporter:
    return OtlpLogExporter(
        endpoint="https://otlp.example.test/otlp/",
        headers={"Authorization": "Basic dGVzdA=="},
        http=httpx2.AsyncClient(transport=httpx2.MockTransport(collector.handle)),
        service="api",
        environment="prod",
        clock_ns=lambda: 1_000,
        sensitive=sensitive or SensitiveValues(),
    )


def attributes(record: dict[str, object]) -> dict[str, str]:
    pairs = cast("list[dict[str, Any]]", record["attributes"])
    return {pair["key"]: pair["value"]["stringValue"] for pair in pairs}


def test_sli_events_reach_the_collector_as_otlp_log_records() -> None:
    collector = Collector()
    sink = exporter(collector)
    emitter = SliEmitter(lambda: datetime(2026, 11, 15, tzinfo=UTC), MemoryBlobs(), sink)
    emitter.observe(SliName.AVAILABILITY, ok=False, attributes={"route": "/api/health"})
    asyncio.run(emitter.flush())
    [request] = collector.requests
    assert str(request.url) == "https://otlp.example.test/otlp/v1/logs"
    assert request.headers["authorization"] == "Basic dGVzdA=="
    [record] = collector.records()
    assert record["body"] == {"stringValue": "sli.api.request"}
    assert attributes(record) == {
        "event": "sli.api.request",
        "route": "/api/health",
        "ok": "false",
        "duration_ms": "0",
    }


def test_keys_off_the_allow_list_and_registered_names_never_leave() -> None:
    collector = Collector()
    sensitive = SensitiveValues()
    sensitive.register(PATIENT_NAME)
    sink = exporter(collector, sensitive)
    sink.export("rum.viewer.frames", {"label": PATIENT_NAME, "route": f"/x/{PATIENT_NAME}"})
    asyncio.run(sink.flush())
    exported = attributes(collector.records()[0])
    assert exported["label"] == REDACTED
    assert PATIENT_NAME not in collector.requests[0].content.decode()


def test_a_collector_outage_drops_the_batch_without_raising() -> None:
    collector = Collector(status=503)
    sink = exporter(collector)
    sink.export("sli.api.request", {"ok": "true"})
    asyncio.run(sink.flush())
    asyncio.run(sink.flush())
    assert len(collector.requests) == 1


def test_headers_are_read_from_the_comma_separated_setting() -> None:
    assert parse_headers("Authorization=Basic abc=, X-Scope = 1") == {
        "Authorization": "Basic abc=",
        "X-Scope": "1",
    }


def test_choosing_otlp_without_an_endpoint_fails_at_startup() -> None:
    settings = ServiceSettings(
        app_env=AppEnv.PROD,
        email_backend="console",
        error_backend="console",
        analytics_backend="none",
        flag_backend="file",
    )
    with pytest.raises(MissingOtlpEndpointError):
        select_clients(settings, ProductionFactories(telemetry=otlp_exporter))


def test_outside_production_the_exporter_is_never_built() -> None:
    built: list[ServiceSettings] = []

    def recording(settings: ServiceSettings) -> OtlpLogExporter:
        built.append(settings)
        return otlp_exporter(settings)

    select_clients(ServiceSettings(app_env=AppEnv.DEV), ProductionFactories(telemetry=recording))
    assert built == []
