import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

from parfocal_common import ingest
from parfocal_common.alerting import SliName
from parfocal_common.job_sli import JobSli, SettledJob
from parfocal_common.jobs import Claimed
from parfocal_common.model_runs import KIND as MODEL_RUN
from parfocal_common.sli_store import BATCH_PREFIX, AlertStateStore, MemoryBlobs, SliEmitter

NOW = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


def claimed(kind: str) -> Claimed:
    return Claimed(uuid.uuid4(), uuid.uuid4(), None, kind)


def settled(kind: str, status: str, took: timedelta, *, counted: bool = True) -> SettledJob:
    return SettledJob(kind, status, NOW - took, NOW, counted)


def run(jobs: list[tuple[Claimed, SettledJob | None]]) -> MemoryBlobs:
    blobs = MemoryBlobs()
    rows = {job.job_id: row for job, row in jobs}

    async def read(job: Claimed) -> SettledJob | None:
        return rows[job.job_id]

    hook = JobSli(SliEmitter(lambda: NOW, blobs), read)

    async def go() -> None:
        for job, _ in jobs:
            await hook(job)

    asyncio.run(go())
    return blobs


def counts(blobs: MemoryBlobs) -> dict[str, list[int]]:
    totals: dict[str, list[int]] = {}
    for body in blobs.objects.values():
        for sli, series in json.loads(body).items():
            for total, bad in series.values():
                entry = totals.setdefault(sli, [0, 0])
                entry[0] += total
                entry[1] += bad
    return totals


def test_the_ingest_worker_counts_slides_ready_late_or_failed_as_bad() -> None:
    blobs = run(
        [
            (claimed(ingest.KIND), settled(ingest.KIND, "done", timedelta(minutes=3))),
            (claimed(ingest.KIND), settled(ingest.KIND, "done", timedelta(minutes=12))),
            (claimed(ingest.KIND), settled(ingest.KIND, "failed", timedelta(minutes=1))),
        ]
    )
    assert all(key.startswith(BATCH_PREFIX) for key in blobs.objects)
    assert counts(blobs) == {SliName.INGEST_TIME.value: [3, 2]}


def test_the_gpu_worker_counts_only_pre_reads_toward_the_pre_read_slo() -> None:
    blobs = run(
        [
            (claimed(MODEL_RUN), settled(MODEL_RUN, "done", timedelta(minutes=20))),
            (claimed(MODEL_RUN), settled(MODEL_RUN, "done", timedelta(minutes=90))),
            (
                claimed(MODEL_RUN),
                settled(MODEL_RUN, "failed", timedelta(minutes=5), counted=False),
            ),
        ]
    )
    assert counts(blobs) == {SliName.PRE_READ_TIME.value: [2, 1]}


def test_retried_cancelled_and_other_jobs_leave_no_count() -> None:
    blobs = run(
        [
            (claimed(ingest.KIND), None),
            (claimed(ingest.KIND), settled(ingest.KIND, "cancelled", timedelta(minutes=1))),
            (claimed("result-import"), settled("result-import", "failed", timedelta(minutes=1))),
        ]
    )
    assert blobs.objects == {}


def test_the_alert_cycle_folds_what_the_workers_wrote() -> None:
    blobs = run(
        [
            (claimed(ingest.KIND), settled(ingest.KIND, "failed", timedelta(minutes=1))),
            (claimed(MODEL_RUN), settled(MODEL_RUN, "done", timedelta(minutes=10))),
        ]
    )
    store = AlertStateStore(blobs)

    async def go() -> dict[str, dict[str, list[int]]]:
        state = await store.load()
        folded = await store.fold(state, NOW)
        await store.save(state, folded)
        return (await store.load()).counts.to_json()

    folded = asyncio.run(go())
    assert {sli: list(series.values()) for sli, series in folded.items()} == {
        SliName.INGEST_TIME.value: [[1, 1]],
        SliName.PRE_READ_TIME.value: [[1, 0]],
    }
    assert not any(key.startswith(BATCH_PREFIX) for key in blobs.objects)
