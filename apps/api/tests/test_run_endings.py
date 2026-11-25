import uuid
from collections.abc import Mapping
from typing import Any

import httpx2
import pytest
from db_support import ApiAs
from storage_support import TEST_STORAGE
from test_lab_model_stage import job_of
from test_model_runs import Lab, control, make_lab, ok, run_async, started
from test_nuclei_run_result_set import MPP, NUCLEI, drained, set_of
from test_tumor_maps import start
from tumor_map_support import CentreScorer, fixture_slide, opener
from workspace_support import owner

from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.jobs import (
    RUN_CANCELLED,
    JobControl,
    StepFailedError,
    StepRun,
    claim,
    move,
    run_job,
)
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.tumor_maps import KIND, MAX_TILES
from parfocal_ml.tumor_map_job import TOO_LARGE, tumor_map_workflow

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

STAGE_BROKE = "stage-broke"


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    made = make_lab(api, database)
    owner(database, f"UPDATE slides SET mpp_x = {MPP}, mpp_y = {MPP} WHERE id = '{made.slides[1]}'")
    return made


async def breaks(step: StepRun) -> Mapping[str, Any]:
    raise StepFailedError(STAGE_BROKE)


def mapped(database: str, lab: Lab, max_tiles: int = MAX_TILES) -> bool:
    async def go(engine: Any) -> bool:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectResultStore(ObjectStore(TEST_STORAGE, http))
            scorer = CentreScorer()
            plan = tumor_map_workflow(opener(fixture_slide()), scorer, store, max_tiles=max_tiles)
            claimed = await claim(engine, "map-worker", {KIND: plan}, lab.tenant)
            if claimed is None:
                return False
            await run_job(engine, claimed[0], claimed[1], "map-worker")
            return True

    return run_async(database, go)


def a_map(api: ApiAs, lab: Lab) -> dict[str, Any]:
    response = start(api, lab)
    assert response.status_code == 201, response.text
    started_map = response.json()
    return {"id": started_map["job_id"]}


def a_nuclei_run(api: ApiAs, lab: Lab) -> dict[str, Any]:
    [run] = started(api, lab, [lab.slides[1]], parameters=NUCLEI)
    return run


def abandon(database: str, run: Mapping[str, Any]) -> None:
    owner(
        database,
        "UPDATE jobs SET status = 'running', claimed_by = 'gone', tries = 3, "
        f"lease_until = now() - interval '1 second' WHERE id = '{run['id']}'",
    )


def hold(database: str, run: Mapping[str, Any]) -> None:
    owner(
        database,
        "UPDATE jobs SET status = 'running', claimed_by = 'gone', tries = 1, "
        f"lease_until = now() + interval '1 hour' WHERE id = '{run['id']}'",
    )


def expire(database: str, run: Mapping[str, Any]) -> None:
    owner(
        database,
        f"UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id = '{run['id']}'",
    )


def moved(database: str, lab: Lab, run: Mapping[str, Any], control_of: JobControl) -> str | None:
    async def go(engine: Any) -> str | None:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=lab.tenant)) as connection:
            found = await move(connection, uuid.UUID(str(run["id"])), control_of)
        assert found is not None
        return None if found.after is None else found.after.value

    return run_async(database, go)


def open_sets(database: str, lab: Lab) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT job_id::text, error_code FROM result_sets "
        f"WHERE tenant_id = '{lab.tenant}' AND status = 'importing' AND deleted_at IS NULL",
    )


def the_set(database: str, run: Mapping[str, Any]) -> tuple[Any, ...]:
    _, status, _, error = set_of(database, run)
    return status, error


def test_a_nuclei_run_that_ends_done_finishes_its_set(api: ApiAs, lab: Lab, database: str) -> None:
    run = a_nuclei_run(api, lab)
    assert drained(database, lab) == 1
    assert job_of(database, run) == ("done", None)
    assert the_set(database, run) == ("ready", None)
    assert open_sets(database, lab) == []


def test_a_nuclei_run_failed_in_a_stage_fails_its_set_with_the_reason(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_nuclei_run(api, lab)
    assert drained(database, lab, breaks) == 1
    assert job_of(database, run) == ("failed", STAGE_BROKE)
    assert the_set(database, run) == ("failed", STAGE_BROKE)
    assert open_sets(database, lab) == []


def test_a_nuclei_run_failed_after_too_many_claims_fails_its_set(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_nuclei_run(api, lab)
    abandon(database, run)
    assert drained(database, lab) == 0
    assert job_of(database, run) == ("failed", "too-many-claims")
    assert the_set(database, run) == ("failed", "too-many-claims")
    assert open_sets(database, lab) == []


def test_a_cancelled_nuclei_run_keeps_its_set_open_with_the_reason_until_resumed(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_nuclei_run(api, lab)
    ok(control(api, lab, run, "cancel"))
    assert job_of(database, run) == ("cancelled", None)
    assert open_sets(database, lab) == [(run["id"], RUN_CANCELLED)]
    ok(control(api, lab, run, "resume"))
    assert open_sets(database, lab) == [(run["id"], None)]
    assert drained(database, lab) == 1
    assert the_set(database, run) == ("ready", None)
    assert open_sets(database, lab) == []


def test_a_nuclei_run_cancelled_while_a_worker_held_it_keeps_its_set_open_with_the_reason(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_nuclei_run(api, lab)
    hold(database, run)
    ok(control(api, lab, run, "cancel"))
    assert job_of(database, run) == ("cancelling", None)
    assert open_sets(database, lab) == [(run["id"], None)]
    expire(database, run)
    assert drained(database, lab) == 0
    assert job_of(database, run) == ("cancelled", None)
    assert open_sets(database, lab) == [(run["id"], RUN_CANCELLED)]


def test_a_tumor_map_that_ends_done_finishes_its_set(api: ApiAs, lab: Lab, database: str) -> None:
    run = a_map(api, lab)
    assert mapped(database, lab)
    assert job_of(database, run) == ("done", None)
    assert the_set(database, run) == ("ready", None)
    assert open_sets(database, lab) == []


def test_a_tumor_map_failed_in_a_stage_fails_its_set_with_the_reason(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_map(api, lab)
    assert mapped(database, lab, max_tiles=0)
    assert job_of(database, run) == ("failed", TOO_LARGE)
    assert the_set(database, run) == ("failed", TOO_LARGE)
    assert open_sets(database, lab) == []


def test_a_tumor_map_failed_after_too_many_claims_fails_its_set(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_map(api, lab)
    abandon(database, run)
    assert not mapped(database, lab)
    assert job_of(database, run) == ("failed", "too-many-claims")
    assert the_set(database, run) == ("failed", "too-many-claims")
    assert open_sets(database, lab) == []


def test_a_cancelled_tumor_map_keeps_its_set_open_with_the_reason_until_resumed(
    api: ApiAs, lab: Lab, database: str
) -> None:
    run = a_map(api, lab)
    assert moved(database, lab, run, JobControl.CANCEL) == "cancelled"
    assert open_sets(database, lab) == [(run["id"], RUN_CANCELLED)]
    assert not mapped(database, lab)
    assert moved(database, lab, run, JobControl.RESUME) == "queued"
    assert mapped(database, lab)
    assert the_set(database, run) == ("ready", None)
    assert open_sets(database, lab) == []
