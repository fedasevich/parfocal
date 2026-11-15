import asyncio
import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from parfocal_common.alerting import (
    AVAILABILITY,
    TILE_LATENCY,
    Alert,
    Alerting,
    OnCall,
    Severity,
    SliName,
    Tally,
    evaluate_slos,
)
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.sli_store import (
    BATCH_PREFIX,
    STATE_KEY,
    AlertState,
    AlertStateStore,
    MemoryBlobs,
    SliCounts,
    SliEmitter,
)

START = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


@dataclass
class FakeClock:
    now: datetime = START

    def __call__(self) -> datetime:
        return self.now


@dataclass
class Exported:
    events: list[tuple[str, dict[str, str]]] = field(
        default_factory=list[tuple[str, dict[str, str]]]
    )

    def export(self, name: str, attributes: Mapping[str, str]) -> None:
        self.events.append((name, dict(attributes)))


def test_a_slow_tile_counts_as_bad_and_is_exported_under_its_sli_name() -> None:
    exported = Exported()
    emitter = SliEmitter(FakeClock(), telemetry=exported)
    emitter.observe(SliName.TILE_LATENCY, ok=True, duration=timedelta(milliseconds=30))
    emitter.observe(SliName.TILE_LATENCY, ok=True, duration=timedelta(milliseconds=90))
    tally = emitter.pending.tally(TILE_LATENCY, START - timedelta(minutes=1), START)
    assert (tally.total, tally.bad) == (2, 1)
    assert [event[1]["ok"] for event in exported.events] == ["true", "false"]
    assert {event[0] for event in exported.events} == {"sli.tile.fetch"}


def test_the_emitter_flushes_once_a_minute_has_closed_and_not_before() -> None:
    clock = FakeClock()
    blobs = MemoryBlobs()
    emitter = SliEmitter(clock, blobs)
    emitter.observe(SliName.AVAILABILITY, ok=True)
    asyncio.run(emitter.flush_if_due())
    assert blobs.objects == {}
    clock.now += timedelta(seconds=61)
    asyncio.run(emitter.flush_if_due())
    [key] = blobs.objects
    assert key.startswith(BATCH_PREFIX)
    assert json.loads(blobs.objects[key]) == {
        "sli.api.request": {str(int(START.timestamp())): [1, 0]}
    }


def test_an_empty_emitter_writes_nothing() -> None:
    blobs = MemoryBlobs()
    asyncio.run(SliEmitter(FakeClock(), blobs).flush())
    assert blobs.objects == {}


def test_state_survives_a_round_trip_through_bytes() -> None:
    counts = SliCounts()
    counts.add(SliName.AVAILABILITY, 60, Tally(4, 1))
    tenant = uuid.uuid4()
    state = AlertState(
        counts=counts,
        firing={"slo:x:page": Alert("slo:x:page", Severity.PAGE, "x", {"slo": "x"})},
        watermarks={tenant: 7},
        folded=["a"],
    )
    loaded = AlertState.from_bytes(state.to_bytes())
    assert loaded.counts.to_json() == counts.to_json()
    assert loaded.firing == state.firing
    assert loaded.watermarks == {tenant: 7}
    assert loaded.folded == ["a"]


def cold_cycle(blobs: MemoryBlobs, outbox: MemoryEmailSender, now: datetime) -> AlertState:
    async def go() -> AlertState:
        store = AlertStateStore(blobs)
        state = await store.load()
        folded = await store.fold(state, now)
        alerting = Alerting(
            OnCall(outbox, "pages@example.test", "tickets@example.test"), state.firing
        )
        evaluate_slos(alerting, state.counts, now)
        state.firing = alerting.firing
        await store.save(state, folded)
        return state

    return asyncio.run(go())


def emit_from_a_fresh_process(blobs: MemoryBlobs, at: datetime, *, ok: bool, count: int) -> None:
    clock = FakeClock(at)
    emitter = SliEmitter(clock, blobs)
    for _ in range(count):
        emitter.observe(SliName.AVAILABILITY, ok=ok)
    asyncio.run(emitter.flush())


def test_an_outage_pages_once_across_cold_starts_and_resolves_once() -> None:
    blobs = MemoryBlobs()
    outbox = MemoryEmailSender()
    emit_from_a_fresh_process(blobs, START, ok=False, count=5)
    emit_from_a_fresh_process(blobs, START, ok=True, count=5)
    cold_cycle(blobs, outbox, START + timedelta(minutes=1))
    cold_cycle(blobs, outbox, START + timedelta(minutes=2))
    assert [message.subject for message in outbox.sent] == [
        "[page] slo:availability:page",
        "[ticket] slo:availability:ticket",
    ]
    assert not [key for key in blobs.objects if key.startswith(BATCH_PREFIX)]
    later = START + timedelta(hours=7)
    emit_from_a_fresh_process(blobs, later, ok=True, count=50)
    cold_cycle(blobs, outbox, later + timedelta(minutes=1))
    assert [message.subject for message in outbox.sent][2:] == [
        "[resolved] slo:availability:page",
        "[resolved] slo:availability:ticket",
    ]


def test_a_batch_whose_delete_failed_is_not_counted_twice() -> None:
    blobs = MemoryBlobs()
    emit_from_a_fresh_process(blobs, START, ok=False, count=2)
    [batch] = list(blobs.objects)
    kept = blobs.objects[batch]
    cold_cycle(blobs, MemoryEmailSender(), START + timedelta(minutes=1))
    blobs.objects[batch] = kept
    cold_cycle(blobs, MemoryEmailSender(), START + timedelta(minutes=2))
    blobs.objects[batch] = kept
    state = cold_cycle(blobs, MemoryEmailSender(), START + timedelta(minutes=3))
    tally = state.counts.tally(AVAILABILITY, START - timedelta(hours=1), START + timedelta(hours=1))
    assert (tally.total, tally.bad) == (2, 2)
    assert batch not in blobs.objects


def test_counts_older_than_the_longest_window_are_pruned() -> None:
    blobs = MemoryBlobs()
    emit_from_a_fresh_process(blobs, START, ok=True, count=1)
    state = cold_cycle(blobs, MemoryEmailSender(), START + timedelta(days=4))
    assert state.counts.oldest() is None
    assert STATE_KEY in blobs.objects
