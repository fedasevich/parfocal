import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from fixture_support import fixture_path
from storage_support import TEST_STORAGE
from test_model_runs import Lab as RunLab
from test_model_runs import make_lab as make_run_lab
from test_model_runs import ok, one_run, read, stage
from upload_support import Lab, send_file, start_upload, status_of
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.tables import Role
from parfocal_common import jobs
from parfocal_common.chunk_store import Cell
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.ingest import STEP_NAMES
from parfocal_common.jobs import (
    Claimed,
    Step,
    StepRun,
    Workflow,
    claim,
    enqueue,
    renew,
    run_job,
)
from parfocal_common.model_runs import STAGES, claim_model_run, workflow
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.workflow import Resources, ingest_workflow
from parfocal_ml.whole_slide import (
    SlideTiles,
    TilePlan,
    Window,
    model_running,
    plan_tiles,
    run_prefix,
    tile_chunk,
    tile_key,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

LEASE_SECONDS = 60.0
UNITS = 6
DERIVE = STEP_NAMES.index("derive")
PUBLISH = STEP_NAMES.index("publish")


class WorkerDiedError(RuntimeError):
    pass


class LeaseClock:
    def __init__(self, database: str) -> None:
        self.database = database

    def advance(self, seconds: float) -> None:
        owner(
            self.database,
            "UPDATE jobs SET lease_until = lease_until - make_interval(secs => "
            f"{seconds}) WHERE lease_until IS NOT NULL",
        )

    def pass_lease(self) -> None:
        self.advance(LEASE_SECONDS + 1)

    def remaining(self, job: uuid.UUID) -> float:
        rows = owner(
            self.database,
            "SELECT extract(epoch FROM lease_until - clock_timestamp()) "
            f"FROM jobs WHERE id = '{job}'",
        )
        return float(str(rows[0][0]))


@pytest.fixture
def clock(database: str) -> LeaseClock:
    return LeaseClock(database)


def run[T](database: str, work_on: Callable[[Any], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await work_on(engine)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def take(
    database: str, plan_of: Workflow, worker: str, tenant: uuid.UUID
) -> tuple[Claimed, Workflow] | None:
    async def go(engine: Any) -> tuple[Claimed, Workflow] | None:
        return await claim(engine, worker, {plan_of.kind: plan_of}, tenant)

    return run(database, go)


def execute(database: str, claimed: tuple[Claimed, Workflow], worker: str) -> None:
    async def go(engine: Any) -> None:
        await run_job(engine, claimed[0], claimed[1], worker)

    run(database, go)


def take_and_run(database: str, plan_of: Workflow, worker: str, tenant: uuid.UUID) -> None:
    claimed = take(database, plan_of, worker, tenant)
    assert claimed is not None
    execute(database, claimed, worker)


def units_of(database: str, job: uuid.UUID, ordinal: int) -> list[tuple[int, str]]:
    rows = owner(
        database,
        f"SELECT unit, worker FROM job_units WHERE job_id = '{job}' AND ordinal = {ordinal} "
        "ORDER BY unit",
    )
    return [(int(str(unit)), str(worker)) for unit, worker in rows]


def steps_of(database: str, job: uuid.UUID) -> list[tuple[str, str, int]]:
    rows = owner(
        database,
        f"SELECT name, status, runs FROM job_steps WHERE job_id = '{job}' ORDER BY ordinal",
    )
    return [(str(name), str(status), int(str(runs))) for name, status, runs in rows]


def job_row(database: str, job: uuid.UUID) -> tuple[str, int, str, str | None]:
    rows = owner(
        database, f"SELECT status, claims, claimed_by, error_code FROM jobs WHERE id = '{job}'"
    )
    status, claims, claimed_by, error_code = rows[0]
    return (
        str(status),
        int(str(claims)),
        str(claimed_by),
        None if error_code is None else str(error_code),
    )


class Counting:
    def __init__(self, die_at: int | None = None, block: asyncio.Event | None = None) -> None:
        self.die_at = die_at
        self.block = block
        self.processed: list[tuple[str, int]] = []
        self.reached = asyncio.Event()

    def workflow(self, kind: str = "test-restart") -> Workflow:
        async def first(step: StepRun) -> Mapping[str, Any]:
            return {"by": step.worker}

        async def counted(step: StepRun) -> Mapping[str, Any]:
            await step.set_total(UNITS)
            done = await step.done_units()
            for unit in range(UNITS):
                if unit in done:
                    continue
                if unit == self.die_at:
                    raise WorkerDiedError(step.worker)
                async with step.transaction() as connection:
                    await step.mark_unit(connection, unit)
                self.processed.append((step.worker, unit))
            if self.block is not None and step.worker == "worker-a":
                self.reached.set()
                await self.block.wait()
            return {"by": step.worker}

        return Workflow(
            kind=kind,
            steps=[Step("first", first), Step("counted", counted), Step("last", first)],
            lease_seconds=LEASE_SECONDS,
        )


def make_job(database: str, plan_of: Workflow) -> tuple[uuid.UUID, uuid.UUID]:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER})
    tenant = workspace.tenant_id
    project = make_project(database, tenant)
    join_project(database, project, workspace.people["lead"], "owner")

    async def go(engine: Any) -> uuid.UUID:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
            return await enqueue(connection, plan_of, tenant, project)

    return tenant, run(database, go)


def test_a_worker_that_dies_mid_step_is_resumed_from_its_last_unit(
    database: str, clock: LeaseClock
) -> None:
    counting = Counting(die_at=3)
    plan_of = counting.workflow()
    tenant, job = make_job(database, plan_of)
    first = take(database, plan_of, "worker-a", tenant)
    assert first is not None
    with pytest.raises(WorkerDiedError):
        execute(database, first, "worker-a")
    assert job_row(database, job)[0] == "running"
    assert steps_of(database, job)[1] == ("counted", "running", 1)
    assert take(database, plan_of, "worker-b", tenant) is None
    clock.pass_lease()
    counting.die_at = None
    take_and_run(database, plan_of, "worker-b", tenant)
    assert units_of(database, job, 1) == [
        *((unit, "worker-a") for unit in range(3)),
        *((unit, "worker-b") for unit in range(3, UNITS)),
    ]
    assert counting.processed == [
        *(("worker-a", unit) for unit in range(3)),
        *(("worker-b", unit) for unit in range(3, UNITS)),
    ]
    assert steps_of(database, job) == [
        ("first", "done", 1),
        ("counted", "done", 2),
        ("last", "done", 1),
    ]
    assert job_row(database, job) == ("done", 2, "worker-b", None)


def test_a_live_lease_keeps_other_workers_away_until_it_runs_out(
    database: str, clock: LeaseClock
) -> None:
    plan_of = Counting().workflow()
    tenant, job = make_job(database, plan_of)
    assert take(database, plan_of, "worker-a", tenant) is not None
    clock.advance(LEASE_SECONDS - 5)
    assert take(database, plan_of, "worker-b", tenant) is None
    clock.advance(10)
    second = take(database, plan_of, "worker-b", tenant)
    assert second is not None
    assert second[0].job_id == job
    assert job_row(database, job)[1:3] == (2, "worker-b")


class SteppedSleep:
    def __init__(self) -> None:
        self.ticks = asyncio.Semaphore(0)
        self.asked: list[float] = []
        self.waiting = asyncio.Event()

    async def sleep(self, seconds: float) -> None:
        self.asked.append(seconds)
        self.waiting.set()
        await self.ticks.acquire()
        self.waiting.clear()

    async def beat(self) -> None:
        await self.until_waiting()
        self.ticks.release()
        await asyncio.sleep(0)
        await self.until_waiting()

    async def until_waiting(self) -> None:
        await asyncio.wait_for(self.waiting.wait(), 10)


class SteppedAsyncio:
    def __init__(self, stepped: SteppedSleep) -> None:
        self.sleep = stepped.sleep

    def __getattr__(self, name: str) -> Any:
        return getattr(asyncio, name)


def test_the_heartbeat_renews_only_a_lease_its_worker_still_holds(
    database: str, clock: LeaseClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan_of = Counting().workflow()
    tenant, job = make_job(database, plan_of)
    claimed = take(database, plan_of, "worker-a", tenant)
    assert claimed is not None
    stepped = SteppedSleep()
    monkeypatch.setattr(jobs, "asyncio", SteppedAsyncio(stepped))
    seen: list[float] = []

    async def go(engine: Any) -> None:
        heartbeat = asyncio.create_task(renew(engine, claimed[0], "worker-a", LEASE_SECONDS))
        await stepped.until_waiting()
        await asyncio.to_thread(clock.advance, 50)
        seen.append(await asyncio.to_thread(clock.remaining, job))
        await stepped.beat()
        seen.append(await asyncio.to_thread(clock.remaining, job))
        steal = f"UPDATE jobs SET claimed_by = 'worker-b' WHERE id = '{job}'"
        await asyncio.to_thread(owner, database, steal)
        await asyncio.to_thread(clock.advance, 50)
        await stepped.beat()
        seen.append(await asyncio.to_thread(clock.remaining, job))
        heartbeat.cancel()
        with pytest.raises(asyncio.CancelledError):
            await heartbeat

    run(database, go)
    assert stepped.asked[0] == LEASE_SECONDS / 3
    assert seen[0] < 11
    assert seen[1] > LEASE_SECONDS - 5
    assert seen[2] < 11


def test_a_frozen_worker_that_wakes_after_losing_its_lease_changes_nothing(
    database: str, clock: LeaseClock
) -> None:
    block = asyncio.Event()
    counting = Counting(block=block)
    plan_of = counting.workflow()
    tenant, job = make_job(database, plan_of)

    async def go(engine: Any) -> None:
        first = await claim(engine, "worker-a", {plan_of.kind: plan_of}, tenant)
        assert first is not None
        frozen = asyncio.create_task(run_job(engine, first[0], first[1], "worker-a"))
        await asyncio.wait_for(counting.reached.wait(), 30)
        await asyncio.to_thread(clock.pass_lease)
        second = await claim(engine, "worker-b", {plan_of.kind: plan_of}, tenant)
        assert second is not None
        await run_job(engine, second[0], second[1], "worker-b")
        block.set()
        await frozen

    run(database, go)
    assert job_row(database, job) == ("done", 2, "worker-b", None)
    results = owner(
        database, f"SELECT name, result FROM job_steps WHERE job_id = '{job}' ORDER BY ordinal"
    )
    assert [result for _, result in results] == [
        {"by": "worker-a"},
        {"by": "worker-b"},
        {"by": "worker-b"},
    ]
    runs = owner(
        database,
        f"SELECT worker FROM stage_throughput WHERE job_id = '{job}' AND ordinal = 1",
    )
    assert runs == [("worker-b",)]


def dying_store(suffix: str, method: str = "put_object") -> type[ObjectStore]:
    class DyingStore(ObjectStore):
        async def put_object(
            self, key: str, body: bytes, content_type: str, *, content_encoding: str | None = None
        ) -> None:
            if method == "put_object" and key.endswith(suffix):
                raise WorkerDiedError(key)
            await super().put_object(key, body, content_type, content_encoding=content_encoding)

        async def delete_object(self, key: str) -> None:
            if method == "delete_object" and key.endswith(suffix):
                raise WorkerDiedError(key)
            await super().delete_object(key)

    return DyingStore


def ingest_with(work_dir: Path, store_class: type[ObjectStore] = ObjectStore) -> Workflow:
    def resources() -> Resources:
        return Resources(TEST_STORAGE, work_dir, store_class=store_class)

    return ingest_workflow(resources, lease_seconds=LEASE_SECONDS)


def uploaded(api: ApiAs, lab: Lab, name: str) -> tuple[dict[str, Any], uuid.UUID]:
    data = fixture_path("synthetic-jpeg.tiff").read_bytes()
    upload = start_upload(api, lab.lead, lab.project, name, len(data))
    send_file(api, lab.lead, upload, data)
    return upload, uuid.UUID(status_of(api, lab.lead, upload)["job_id"])


def slides_of(database: str, lab: Lab) -> int:
    return len(owner(database, f"SELECT id FROM slides WHERE project_id = '{lab.project}'"))


def die_once(
    database: str,
    clock: LeaseClock,
    lab: Lab,
    dying: Workflow,
    healthy: Workflow,
) -> None:
    first = take(database, dying, "worker-a", lab.tenant_id)
    assert first is not None
    with pytest.raises(WorkerDiedError):
        execute(database, first, "worker-a")
    clock.pass_lease()
    take_and_run(database, healthy, "worker-b", lab.tenant_id)


def test_an_ingest_worker_that_dies_while_deriving_resumes_after_its_last_unit(
    api: ApiAs, database: str, lab: Lab, clock: LeaseClock, tmp_path: Path
) -> None:
    upload, job = uploaded(api, lab, "dies-deriving.tiff")
    dying = ingest_with(tmp_path / "a", dying_store("tissue.png"))
    die_once(database, clock, lab, dying, ingest_with(tmp_path / "b"))
    assert units_of(database, job, DERIVE) == [(0, "worker-a"), (1, "worker-b"), (2, "worker-b")]
    runs = {name: count for name, _, count in steps_of(database, job)}
    assert runs["derive"] == 2
    assert all(runs[name] == 1 for name in STEP_NAMES if name != "derive")
    assert status_of(api, lab.lead, upload)["status"] == "ready"
    assert job_row(database, job) == ("done", 2, "worker-b", None)
    assert slides_of(database, lab) == 1
    assert not (tmp_path / "b" / str(job)).exists()


def test_an_ingest_worker_that_dies_after_publishing_publishes_the_slide_once(
    api: ApiAs, database: str, lab: Lab, clock: LeaseClock, tmp_path: Path
) -> None:
    upload, job = uploaded(api, lab, "dies-publishing.tiff")
    stored = owner(
        database,
        "SELECT object_key FROM uploads WHERE id = "
        f"(SELECT (input->>'upload_id')::uuid FROM jobs WHERE id = '{job}')",
    )
    key = str(stored[0][0])
    dying = ingest_with(tmp_path / "a", dying_store(key, "delete_object"))
    die_once(database, clock, lab, dying, ingest_with(tmp_path / "b"))
    steps = steps_of(database, job)
    assert steps[PUBLISH] == ("publish", "done", 2)
    assert all(runs == 1 for name, _, runs in steps if name != "publish")
    state = status_of(api, lab.lead, upload)
    assert state["status"] == "ready"
    assert slides_of(database, lab) == 1
    assert str(state["slide_id"]) == str(
        owner(database, f"SELECT id FROM slides WHERE project_id = '{lab.project}'")[0][0]
    )


def test_an_ingest_job_whose_worker_dies_three_times_fails_for_good(
    api: ApiAs, database: str, lab: Lab, clock: LeaseClock, tmp_path: Path
) -> None:
    upload, job = uploaded(api, lab, "dies-thrice.tiff")
    dying = ingest_with(tmp_path / "a", dying_store("tissue.png"))
    for worker in ("worker-a", "worker-b", "worker-c"):
        claimed = take(database, dying, worker, lab.tenant_id)
        assert claimed is not None
        with pytest.raises(WorkerDiedError):
            execute(database, claimed, worker)
        clock.pass_lease()
    assert take(database, ingest_with(tmp_path / "b"), "worker-d", lab.tenant_id) is None
    assert job_row(database, job)[0::3] == ("failed", "too-many-claims")
    assert ("derive", "failed", 3) in steps_of(database, job)
    state = status_of(api, lab.lead, upload)
    assert (state["status"], state["reason"], state["slide_id"]) == (
        "failed",
        "too-many-claims",
        None,
    )
    assert slides_of(database, lab) == 0


SLIDE = Window(0, 0, 900, 600)
CORE = 256
HALO = 20


def square(x: float, y: float) -> list[float]:
    return [x, y, x + 6, y, x + 6, y + 6, x, y + 6]


class GridDetector:
    classes = 3

    def __init__(self, die_after: int | None = None) -> None:
        self.die_after = die_after
        self.windows: list[Window] = []

    async def detect(self, window: Window) -> Sequence[Cell]:
        if self.die_after is not None and len(self.windows) == self.die_after:
            raise WorkerDiedError("gpu worker died")
        self.windows.append(window)
        return [
            Cell(0, square(x, y), class_index=(x + y) % 3, score=(x * y) % 256)
            for y in range(-(-window.y // 37) * 37, window.bottom - 6, 37)
            for x in range(-(-window.x // 41) * 41, window.right - 6, 41)
        ]


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


def slide_plan() -> TilePlan:
    return plan_tiles(SLIDE, SLIDE, CORE, HALO)


async def chunks_without_a_death(prefix: str) -> dict[str, bytes]:
    whole = slide_plan()
    detector = GridDetector()
    chunks: dict[str, bytes] = {}
    for tile in whole.tiles:
        cells = await detector.detect(whole.window_of(tile))
        chunks[tile_key(prefix, tile.index)] = tile_chunk(tile, cells, detector.classes)[0]
    return chunks


def pre_read(detector: GridDetector, store: MemoryStore) -> Workflow:
    whole = slide_plan()

    async def tiles_of(step: StepRun) -> SlideTiles:
        return SlideTiles(whole, whole.tiles, run_prefix(step.tenant_id, step.job_id, step.job_id))

    async def quick(step: StepRun) -> Mapping[str, Any]:
        await step.set_total(1)
        if 0 not in await step.done_units():
            async with step.transaction() as connection:
                await step.mark_unit(connection, 0)
        return {"units": 1}

    running = model_running(tiles_of, detector, store)
    return workflow(
        {name: running if name == "model-running" else quick for name in STAGES},
        lease_seconds=LEASE_SECONDS,
    )


@pytest.fixture
def run_lab(api: ApiAs, database: str) -> RunLab:
    return make_run_lab(api, database)


def test_a_pre_read_whose_gpu_worker_dies_resumes_to_the_same_chunks(
    api: ApiAs, database: str, run_lab: RunLab, clock: LeaseClock
) -> None:
    run_info = one_run(api, run_lab)
    job = uuid.UUID(run_info["id"])
    store = MemoryStore()
    first_detector = GridDetector(die_after=2)
    second_detector = GridDetector()

    async def first(engine: Any) -> None:
        claimed = await claim_model_run(
            engine, "gpu-a", pre_read(first_detector, store), run_lab.tenant
        )
        assert claimed is not None
        await run_job(engine, claimed.job, claimed.workflow, "gpu-a")

    with pytest.raises(WorkerDiedError):
        run(database, first)
    assert stage(ok(read(api, run_lab, run_info)), "model-running")["status"] == "running"
    clock.pass_lease()

    async def second(engine: Any) -> None:
        claimed = await claim_model_run(
            engine, "gpu-b", pre_read(second_detector, store), run_lab.tenant
        )
        assert claimed is not None
        await run_job(engine, claimed.job, claimed.workflow, "gpu-b")

    run(database, second)
    tiles = slide_plan().tiles
    units = units_of(database, job, STAGES.index("model-running"))
    assert [unit for unit, _ in units] == sorted(tile.index for tile in tiles)
    assert [worker for _, worker in units].count("gpu-a") == 2
    assert len(second_detector.windows) == len(tiles) - 2
    prefix = run_prefix(run_lab.tenant, job, job)
    assert store.objects == asyncio.run(chunks_without_a_death(prefix))
    finished = ok(read(api, run_lab, run_info))
    assert (finished["status"], finished["attempts"]) == ("done", 2)
    assert stage(finished, "model-running")["status"] == "done"
