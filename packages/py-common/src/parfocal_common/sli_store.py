import json
import logging
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol, cast

from parfocal_common.alerting import (
    BURN_RULES,
    SLOS,
    Alert,
    Severity,
    SliName,
    SliSource,
    Slo,
    Tally,
)
from parfocal_common.clients import TelemetryExporter
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.otlp import FlushingExporter

type Clock = Callable[[], datetime]

BATCH_PREFIX = "ops/sli/batches/"
STATE_KEY = "ops/alerting/state.json"
BUCKET_SECONDS = 60
RETAINED = max(rule.long for rule in BURN_RULES) + timedelta(hours=1)
SLO_BY_SLI: dict[SliName, Slo] = {slo.sli: slo for slo in SLOS}

logger = logging.getLogger("parfocal.sli")


class Blobs(Protocol):
    async def put(self, key: str, body: bytes) -> None: ...

    async def get(self, key: str) -> bytes | None: ...

    async def keys(self, prefix: str) -> list[str]: ...

    async def delete(self, key: str) -> None: ...


@dataclass(frozen=True)
class ObjectBlobs:
    store: ObjectStore

    async def put(self, key: str, body: bytes) -> None:
        await self.store.put_object(key, body, "application/json")

    async def get(self, key: str) -> bytes | None:
        try:
            return await self.store.get_object(key)
        except StorageError as error:
            if error.status == 404:
                return None
            raise

    async def keys(self, prefix: str) -> list[str]:
        return await self.store.list_keys(prefix)

    async def delete(self, key: str) -> None:
        await self.store.delete_object(key)


@dataclass
class MemoryBlobs:
    objects: dict[str, bytes] = field(default_factory=dict[str, bytes])

    async def put(self, key: str, body: bytes) -> None:
        self.objects[key] = body

    async def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    async def keys(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)


def bucket_of(at: datetime) -> int:
    return int(at.timestamp()) // BUCKET_SECONDS * BUCKET_SECONDS


@dataclass
class SliCounts:
    buckets: dict[SliName, dict[int, Tally]] = field(
        default_factory=dict[SliName, dict[int, Tally]]
    )

    def add(self, sli: SliName, bucket: int, tally: Tally) -> None:
        series = self.buckets.setdefault(sli, {})
        series[bucket] = series.get(bucket, Tally()) + tally

    def merge(self, other: SliCounts) -> None:
        for sli, series in other.buckets.items():
            for bucket, tally in series.items():
                self.add(sli, bucket, tally)

    def prune(self, before: datetime) -> None:
        cutoff = bucket_of(before)
        for series in self.buckets.values():
            for bucket in [bucket for bucket in series if bucket < cutoff]:
                del series[bucket]

    def oldest(self) -> int | None:
        starts = [bucket for series in self.buckets.values() for bucket in series]
        return min(starts) if starts else None

    def tally(self, slo: Slo, start: datetime, end: datetime) -> Tally:
        low, high = start.timestamp(), end.timestamp()
        total = Tally()
        for bucket, tally in self.buckets.get(slo.sli, {}).items():
            if bucket <= high and bucket + BUCKET_SECONDS > low:
                total += tally
        return total

    def to_json(self) -> dict[str, dict[str, list[int]]]:
        return {
            sli.value: {str(bucket): [tally.total, tally.bad] for bucket, tally in series.items()}
            for sli, series in self.buckets.items()
            if series
        }

    @classmethod
    def from_json(cls, raw: Mapping[str, Mapping[str, list[int]]]) -> SliCounts:
        counts = cls()
        for name, series in raw.items():
            for bucket, (total, bad) in series.items():
                counts.add(SliName(name), int(bucket), Tally(int(total), int(bad)))
        return counts


@dataclass(frozen=True)
class CombinedSource:
    sources: tuple[SliSource, ...]

    def tally(self, slo: Slo, start: datetime, end: datetime) -> Tally:
        total = Tally()
        for source in self.sources:
            total += source.tally(slo, start, end)
        return total


@dataclass
class SliEmitter:
    clock: Clock
    blobs: Blobs | None = None
    telemetry: TelemetryExporter | None = None
    pending: SliCounts = field(default_factory=SliCounts)

    def observe(
        self,
        sli: SliName,
        *,
        ok: bool,
        duration: timedelta = timedelta(0),
        attributes: Mapping[str, str] | None = None,
    ) -> None:
        slo = SLO_BY_SLI[sli]
        good = ok and (slo.threshold is None or duration <= slo.threshold)
        self.pending.add(sli, bucket_of(self.clock()), Tally(1, 0 if good else 1))
        if self.telemetry is not None:
            self.telemetry.export(
                sli.value,
                {
                    **(attributes or {}),
                    "ok": "true" if good else "false",
                    "duration_ms": f"{duration.total_seconds() * 1000:.0f}",
                },
            )

    def due(self) -> bool:
        oldest = self.pending.oldest()
        return oldest is not None and bucket_of(self.clock()) > oldest

    async def flush(self) -> None:
        if isinstance(self.telemetry, FlushingExporter):
            await self.telemetry.flush()
        if self.blobs is None or self.pending.oldest() is None:
            self.pending = SliCounts()
            return
        batch, self.pending = self.pending, SliCounts()
        key = f"{BATCH_PREFIX}{bucket_of(self.clock())}-{uuid.uuid4().hex}.json"
        try:
            await self.blobs.put(key, json.dumps(batch.to_json()).encode())
        except Exception as error:
            logger.warning("sli batch not stored", extra={"error_type": type(error).__name__})

    async def flush_if_due(self) -> None:
        if self.due():
            await self.flush()


def alert_to_json(alert: Alert) -> dict[str, object]:
    return {
        "key": alert.key,
        "severity": alert.severity.value,
        "summary": alert.summary,
        "labels": dict(alert.labels),
    }


def alert_from_json(raw: Mapping[str, object]) -> Alert:
    labels = cast("dict[str, str]", raw.get("labels", {}))
    return Alert(
        key=str(raw["key"]),
        severity=Severity(str(raw["severity"])),
        summary=str(raw["summary"]),
        labels={str(name): str(value) for name, value in labels.items()},
    )


@dataclass
class AlertState:
    counts: SliCounts = field(default_factory=SliCounts)
    firing: dict[str, Alert] = field(default_factory=dict[str, Alert])
    watermarks: dict[uuid.UUID, int] = field(default_factory=dict[uuid.UUID, int])
    folded: list[str] = field(default_factory=list[str])

    def to_bytes(self) -> bytes:
        return json.dumps(
            {
                "counts": self.counts.to_json(),
                "firing": [alert_to_json(alert) for alert in self.firing.values()],
                "watermarks": {str(tenant): seq for tenant, seq in self.watermarks.items()},
                "folded": self.folded,
            }
        ).encode()

    @classmethod
    def from_bytes(cls, raw: bytes) -> AlertState:
        parsed = json.loads(raw)
        firing = [alert_from_json(item) for item in parsed.get("firing", [])]
        return cls(
            counts=SliCounts.from_json(parsed.get("counts", {})),
            firing={alert.key: alert for alert in firing},
            watermarks={
                uuid.UUID(tenant): int(seq) for tenant, seq in parsed.get("watermarks", {}).items()
            },
            folded=[str(key) for key in parsed.get("folded", [])],
        )


@dataclass(frozen=True)
class AlertStateStore:
    blobs: Blobs

    async def load(self) -> AlertState:
        raw = await self.blobs.get(STATE_KEY)
        return AlertState() if raw is None else AlertState.from_bytes(raw)

    async def fold(self, state: AlertState, now: datetime) -> list[str]:
        already = set(state.folded)
        listed = await self.blobs.keys(BATCH_PREFIX)
        leftover = [key for key in listed if key in already]
        fresh = [key for key in listed if key not in already]
        for key in fresh:
            raw = await self.blobs.get(key)
            if raw is not None:
                state.counts.merge(SliCounts.from_json(json.loads(raw)))
        state.counts.prune(now - RETAINED)
        state.folded = fresh
        return [*leftover, *fresh]

    async def save(self, state: AlertState, folded: Iterable[str]) -> None:
        await self.blobs.put(STATE_KEY, state.to_bytes())
        for key in folded:
            await self.blobs.delete(key)
