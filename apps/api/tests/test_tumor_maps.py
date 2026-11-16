import asyncio
import uuid
from typing import Any

import httpx2
import pytest
from db_support import APP_URL, ApiAs, with_database
from storage_support import TEST_STORAGE
from test_model_runs import Lab, make_lab, ok, problem
from test_tumor_map_job import mapped_in_one_pass
from tumor_map_support import CentreScorer, fixture_slide, opener

from parfocal_common.db import create_engine
from parfocal_common.jobs import claim, run_job
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.tumor_maps import KIND, STEPS
from parfocal_ml.tumor_map_job import tumor_map_workflow

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


def maps_of(lab: Lab, slide: uuid.UUID | None = None) -> str:
    return f"/api/projects/{lab.project}/slides/{slide or lab.slides[0]}/tumor-maps"


def start(api: ApiAs, lab: Lab, who: str = "owner", slide: uuid.UUID | None = None) -> Any:
    return api(lab.people[who]).post(maps_of(lab, slide))


def work(database: str, tenant: uuid.UUID) -> bool:
    async def go() -> bool:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with httpx2.AsyncClient(timeout=30) as http:
                store = ObjectResultStore(ObjectStore(TEST_STORAGE, http))
                plan = tumor_map_workflow(opener(fixture_slide()), CentreScorer(), store)
                claimed = await claim(engine, "gpu-1", {KIND: plan}, tenant)
                if claimed is None:
                    return False
                await run_job(engine, claimed[0], claimed[1], "gpu-1")
                return True
        finally:
            await engine.dispose()

    return asyncio.run(go())


def test_a_started_tumor_map_is_served_through_the_heatmap_route(
    api: ApiAs, database: str, lab: Lab
):
    response = start(api, lab)
    assert response.status_code == 201, response.text
    started = response.json()
    assert started["status"] == "queued"
    assert started["slide_id"] == str(lab.slides[0])
    set_id = started["result_set_id"]
    reader = api(lab.people["owner"])
    assert problem(reader.get(f"/api/result-sets/{set_id}/heatmap")) == (404, "no-heatmap")

    assert work(database, lab.tenant)

    job = ok(reader.get(f"/api/projects/{lab.project}/jobs/{started['job_id']}"))
    assert (job["kind"], job["status"]) == (KIND, "done")
    assert [step["name"] for step in job["steps"]] == list(STEPS)
    assert job["steps"][0]["units_done"] == job["steps"][0]["units_total"] == 4
    sets = ok(reader.get(f"/api/slides/{lab.slides[0]}/result-sets"))
    mine = next(item for item in sets if item["id"] == set_id)
    assert (mine["status"], mine["source"], mine["cell_count"]) == ("ready", "run", 0)
    facts = ok(reader.get(f"/api/result-sets/{set_id}/heatmap"))
    assert (facts["width"], facts["height"], facts["downsample"], facts["level"]) == (
        44,
        40,
        64.0,
        6,
    )
    grid = reader.get(f"/api/result-sets/{set_id}/heatmap/grid")
    assert grid.status_code == 200
    assert grid.content == mapped_in_one_pass().tobytes()


def test_only_members_who_run_models_start_a_tumor_map(api: ApiAs, database: str, lab: Lab):
    for who in ("viewer", "reader", "outsider"):
        assert start(api, lab, who).status_code in {403, 404}
    assert not work(database, lab.tenant)


def test_a_tumor_map_needs_a_slide_of_the_project(api: ApiAs, lab: Lab):
    assert problem(start(api, lab, slide=uuid.uuid4())) == (400, "slide-not-in-project")


def test_a_reviewer_reads_a_tumor_map_job_only_on_a_slide_they_review(api: ApiAs, lab: Lab):
    on_task = ok(start(api, lab))
    off_task = ok(start(api, lab, slide=lab.slides[1]))
    reader = api(lab.people["reader"])
    jobs = f"/api/projects/{lab.project}/jobs"
    assert reader.get(f"{jobs}/{on_task['job_id']}").status_code == 200
    assert reader.get(f"{jobs}/{off_task['job_id']}").status_code == 404
