import asyncio
import threading
import uuid
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import Lab, claim, make_lab, ok, one_run, read, run_async, stage, started
from workspace_support import owner

from parfocal_common.jobs import StepPausedError, StepRun
from parfocal_common.model_runs import (
    STAGES,
    Area,
    ClaimedRun,
    mark_area,
    run_model_run,
    workflow,
)

pytestmark = pytest.mark.db

TILE = 512


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


def area(unit: int) -> Area:
    return Area(x=unit * TILE, y=0, width=TILE, height=TILE, objects=unit + 1)


class Gate:
    def __init__(self, after: int) -> None:
        self.after = after
        self.reached = threading.Event()
        self.release = threading.Event()


def tiled_plan(total: int, gate: Gate | None = None, pause_at: int | None = None) -> Any:
    async def quick(step: StepRun) -> Mapping[str, Any]:
        await step.set_total(1)
        if 0 not in await step.done_units():
            async with step.transaction() as connection:
                await step.mark_unit(connection, 0)
        return {"units": 1}

    async def model(step: StepRun) -> Mapping[str, Any]:
        await step.set_total(total)
        done = await step.done_units()
        for unit in range(total):
            if unit in done:
                continue
            if gate is not None and unit == gate.after:
                gate.reached.set()
                await asyncio.to_thread(gate.release.wait, 30)
            if unit == pause_at:
                raise StepPausedError("gpu-busy")
            async with step.transaction() as connection:
                await mark_area(step, connection, unit, area(unit))
        return {"tiles": total}

    return workflow({name: model if name == "model-running" else quick for name in STAGES})


def execute(
    database: str, claimed: ClaimedRun, worker: str = "worker-1", tier: str | None = "best"
) -> None:
    async def go(engine: Any) -> None:
        await run_model_run(engine, claimed, worker, tier=tier, machine="gpu-test-1")

    run_async(database, go)


def areas(api: ApiAs, lab: Lab, run: Mapping[str, Any], after: int = 0) -> Any:
    return ok(api(lab.people["owner"]).get(f"{lab.runs}/{run['id']}/areas?after={after}"))


COLUMNS = ("stage", "run", "kind", "model", "model_version", "tier", "machine", "worker")
NUMBERS = ("units", "seconds")


def throughput_rows(database: str, run: Mapping[str, Any]) -> list[SimpleNamespace]:
    rows = owner(
        database,
        f"SELECT {', '.join(COLUMNS + NUMBERS)} "
        f"FROM stage_throughput WHERE job_id = '{run['id']}' ORDER BY ordinal, run",
    )
    return [SimpleNamespace(**dict(zip(COLUMNS + NUMBERS, row, strict=True))) for row in rows]


def test_partial_areas_arrive_before_the_run_completes(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    gate = Gate(after=2)
    claimed = claim(database, lab, tiled_plan(4, gate))
    worker = threading.Thread(target=execute, args=(database, claimed))
    worker.start()
    try:
        assert gate.reached.wait(30)
        early = areas(api, lab, run)
        running = ok(read(api, lab, run))
    finally:
        gate.release.set()
        worker.join(60)
    assert early["status"] == "running"
    assert running["status"] == "running"
    assert [item["unit"] for item in early["areas"]] == [0, 1]
    assert {item["stage"] for item in early["areas"]} == {"model-running"}
    assert (early["areas"][1]["x"], early["areas"][1]["objects"]) == (TILE, 2)
    model = stage(running, "model-running")
    assert (model["status"], model["units_done"], model["units_total"]) == ("running", 2, 4)
    rest = areas(api, lab, run, early["after"])
    assert rest["status"] == "done"
    assert [item["unit"] for item in rest["areas"]] == [2, 3]
    assert areas(api, lab, run, rest["after"])["areas"] == []


def test_each_finished_stage_records_its_throughput(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    execute(database, claim(database, lab, tiled_plan(3)))
    rows = throughput_rows(database, run)
    assert [row.stage for row in rows] == list(STAGES)
    detector = run["parameters"]["detector"]
    for row in rows:
        assert (row.kind, row.model, row.model_version) == (
            "model-run",
            detector["name"],
            detector["version"],
        )
        assert (row.tier, row.machine, row.worker, row.run) == ("best", "gpu-test-1", "worker-1", 1)
        assert row.seconds >= 0
    units = {row.stage: row.units for row in rows}
    assert units["model-running"] == 3
    assert units["tiles-read"] == 1


def test_a_resumed_stage_counts_only_the_units_of_its_own_run(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    execute(database, claim(database, lab, tiled_plan(4, pause_at=3)))
    paused = ok(read(api, lab, run))
    assert paused["status"] == "paused"
    waiting = [item for item in paused["stages"] if item["waiting_reason"] is not None]
    assert [(item["name"], item["waiting_reason"]) for item in waiting] == [
        ("model-running", "gpu-busy")
    ]
    assert [row.stage for row in throughput_rows(database, run)] == ["tiles-read", "tissue-found"]
    assert len(areas(api, lab, run)["areas"]) == 3
    ok(api(lab.people["owner"]).post(f"{lab.runs}/{run['id']}/resume"))
    execute(database, claim(database, lab, tiled_plan(4), "worker-2"), "worker-2", tier=None)
    rows = {row.stage: row for row in throughput_rows(database, run)}
    model = rows["model-running"]
    assert (model.run, model.units, model.worker, model.tier) == (2, 1, "worker-2", None)
    assert ok(read(api, lab, run))["status"] == "done"


def test_the_estimate_uses_the_recorded_stage_times(api: ApiAs, database: str, lab: Lab) -> None:
    detector = {"name": "hovernet"}
    runs = started(api, lab, lab.slides, parameters={"detector": detector})
    for _ in runs:
        claimed = claim(database, lab, tiled_plan(2))
        execute(database, claimed)
        owner(
            database,
            f"UPDATE stage_throughput SET seconds = 30 WHERE job_id = '{claimed.job.job_id}'",
        )
    listed = ok(api(lab.people["owner"]).get(f"/api/projects/{lab.project}/models"))
    hovernet = next(model for model in listed if model["name"] == "hovernet")
    assert (hovernet["measured"], hovernet["minutes_per_slide"]) == (True, 3)


def test_people_outside_the_project_see_no_areas(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    execute(database, claim(database, lab, tiled_plan(2)))
    response = api(lab.people["outsider"]).get(f"{lab.runs}/{run['id']}/areas")
    assert response.status_code == 404
    missing = api(lab.people["owner"]).get(f"{lab.runs}/{uuid.uuid4()}/areas")
    assert missing.status_code == 404
