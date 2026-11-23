import uuid
from collections.abc import Generator
from datetime import datetime
from typing import cast

import pytest
from db_support import ApiAs
from test_my_jobs import job, my_jobs
from test_review_tasks import Study, study
from workspace_support import owner

from parfocal_api.run_waits import PoolWatch
from parfocal_common.model_runs import NUCLEI_POOL_FUNCTION
from parfocal_common.warm_gate import PoolLoad

pytestmark = pytest.mark.db


class LoadedPool:
    def __init__(self, backlog: int, runners: int) -> None:
        self.current = PoolLoad(backlog=backlog, runners=runners)
        self.spawned: list[tuple[str, dict[str, object]]] = []
        self.reads = 0

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.spawned.append((function_name, call))
        self.current = PoolLoad(backlog=self.current.backlog + 1, runners=self.current.runners)

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return {}

    def load(self, function_name: str) -> PoolLoad:
        assert function_name == NUCLEI_POOL_FUNCTION
        self.reads += 1
        return self.current


@pytest.fixture
def pool(api: ApiAs) -> Generator[LoadedPool]:
    loaded = LoadedPool(backlog=0, runners=0)
    api.app.state.gpu_pools = loaded
    try:
        yield loaded
    finally:
        del api.app.state.gpu_pools
        if hasattr(api.app.state, "pool_watch"):
            del api.app.state.pool_watch


def queued_run(
    database: str, s: Study, ago: str, detector: str = "pathosam-hovernext"
) -> uuid.UUID:
    job_id = job(database, s, "model-run", "queued", ago)
    owner(
        database,
        "INSERT INTO model_runs (job_id, tenant_id, project_id, slide_id, batch_id, scope_kind, "
        "detector, detector_version, test_time_views, ordering, started_by_user_id) "
        f"VALUES ('{job_id}', '{s.tenant_id}', '{s.project}', '{s.slides[0]}', "
        f"'{uuid.uuid4()}', 'slide', '{detector}', 'v1', 1, 'raster', '{s.user('owner')}')",
    )
    return job_id


def only(api: ApiAs, s: Study) -> dict[str, object]:
    [found] = my_jobs(api, s, "owner")
    assert found["status"] == "queued"
    return found


def test_a_run_whose_pool_waits_for_a_gpu_says_so(
    api: ApiAs, database: str, pool: LoadedPool
) -> None:
    s = study(database)
    pool.current = PoolLoad(backlog=1, runners=0)
    queued_run(database, s, "18 minutes")

    found = only(api, s)

    wait = cast("dict[str, str]", found["wait"])
    assert wait["reason"] == "waiting-for-gpu"
    assert datetime.fromisoformat(wait["since"]) == datetime.fromisoformat(str(found["created_at"]))
    assert found["pause"] is None
    assert pool.spawned == []


def test_a_run_behind_a_busy_gpu_says_so(api: ApiAs, database: str, pool: LoadedPool) -> None:
    s = study(database)
    pool.current = PoolLoad(backlog=0, runners=1)
    queued_run(database, s, "3 minutes")

    assert only(api, s)["wait"] == {"reason": "gpu-busy", "since": only(api, s)["created_at"]}
    assert pool.spawned == []


def test_a_lost_wake_wakes_the_pool_again_once(api: ApiAs, database: str, pool: LoadedPool) -> None:
    s = study(database)
    queued_run(database, s, "5 minutes")

    first = only(api, s)
    second = only(api, s)

    assert pool.spawned == [(NUCLEI_POOL_FUNCTION, {"kind": "detect"})]
    assert isinstance(first["wait"], dict)
    assert first["wait"]["reason"] == "woken-again"
    assert isinstance(second["wait"], dict)
    assert second["wait"]["reason"] == "waiting-for-gpu"


def test_a_fresh_run_is_not_woken_again(api: ApiAs, database: str, pool: LoadedPool) -> None:
    s = study(database)
    queued_run(database, s, "5 seconds")

    assert only(api, s)["wait"] is None
    assert pool.spawned == []


def test_a_run_on_another_server_reads_no_gpu_wait(
    api: ApiAs, database: str, pool: LoadedPool
) -> None:
    s = study(database)
    pool.current = PoolLoad(backlog=1, runners=0)
    queued_run(database, s, "5 minutes", detector="hovernet")

    assert only(api, s)["wait"] is None
    assert pool.reads == 0


def finished_run(database: str, s: Study, waited_seconds: int) -> None:
    job_id = queued_run(database, s, "1 hour")
    owner(database, f"UPDATE jobs SET status = 'done' WHERE id = '{job_id}'")
    owner(
        database,
        "INSERT INTO job_steps (tenant_id, job_id, ordinal, name, status, started_at) "
        f"SELECT '{s.tenant_id}', id, 0, 'tiles-read', 'done', "
        f"created_at + interval '{waited_seconds} seconds' FROM jobs WHERE id = '{job_id}' "
        "RETURNING job_id",
    )


def test_the_estimate_adds_the_measured_gpu_start(api: ApiAs, database: str) -> None:
    s = study(database)
    for waited in (60, 150, 1100):
        finished_run(database, s, waited)

    response = api(s.people["owner"]).get(f"/api/projects/{s.project}/models")
    assert response.status_code == 200, response.text
    starts = {model["name"]: model["start_minutes"] for model in response.json()}

    assert starts["pathosam-hovernext"] == 3
    assert {name: minutes for name, minutes in starts.items() if minutes} == {
        "pathosam-hovernext": 3
    }


def test_the_pool_is_read_at_most_once_per_freshness_window() -> None:
    pool = LoadedPool(backlog=1, runners=0)
    now = [100.0]
    watch = PoolWatch(pool, pool, clock=lambda: now[0])

    watch.reason(600.0)
    watch.reason(600.0)
    now[0] += 11.0
    watch.reason(600.0)

    assert pool.reads == 2


def test_a_failed_wake_is_tried_again_after_the_gap() -> None:
    class Refusing(LoadedPool):
        def spawn(self, function_name: str, call: dict[str, object]) -> None:
            self.spawned.append((function_name, call))
            raise RuntimeError("app is being redeployed")

    pool = Refusing(backlog=0, runners=0)
    now = [100.0]
    watch = PoolWatch(pool, pool, clock=lambda: now[0])

    assert watch.reason(600.0) is None
    now[0] += 30.0
    watch.reason(600.0)
    now[0] += 31.0
    watch.reason(600.0)

    assert len(pool.spawned) == 2
