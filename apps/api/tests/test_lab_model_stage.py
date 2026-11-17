import logging
import uuid
from collections.abc import Iterator, Mapping
from typing import Any

import numpy as np
import pytest
from db_support import TEST_MASTER_KEYS, ApiAs, api_settings
from fastapi.testclient import TestClient
from link_support import Site, serving
from test_lab_models import INFER, MODELS, TOKEN, draft, lab_run, lowered, square
from test_model_runs import Lab, make_lab, ok, run_async
from workspace_support import owner

from parfocal_api.app import create_app
from parfocal_common.chunk_store import read_chunk
from parfocal_common.envelope import MasterKeyring
from parfocal_common.jobs import StepRun
from parfocal_common.link_fetch import policy_of
from parfocal_common.model_runs import (
    MODEL_STAGE,
    STAGES,
    claim_model_run,
    run_model_run,
    run_prefix,
    tile_key,
    workflow,
)
from parfocal_ml.lab_model_stage import LabSlide, lab_model_running
from parfocal_ml.whole_slide import Window

pytestmark = pytest.mark.db

SLIDE = Window(0, 0, 512, 400)
NAME = "lab-hovernet"
ANSWER = {
    "model": NAME,
    "version": "2.1",
    "objects": [
        {"kind": "region", "class": "tumor", "geometry": square(10, 10, 200)},
        {"kind": "region", "class": "tumor", "geometry": square(400, 300, 300)},
        {"kind": "region", "class": "necrosis", "geometry": square(30, 30, 50)},
        {"kind": "cell", "class": "neoplastic", "geometry": square(40, 40)},
        {"kind": "cell", "class": "neoplastic", "geometry": square(80, 60)},
        {"kind": "cell", "class": "inflammatory", "geometry": square(300, 200)},
        {"kind": "cell", "class": "dead", "geometry": square(350, 250)},
    ],
}
SCANNED = (
    "jobs",
    "job_steps",
    "job_units",
    "model_runs",
    "result_sets",
    "result_objects",
    "audit_events",
)


class FlatReader:
    mpp = 0.25

    async def read(self, window: Window, width: int, height: int) -> np.ndarray:
        return np.full((height, width, 3), (200, 120, 170), dtype=np.uint8)


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        yield served


@pytest.fixture
def linked(database: str, site: Site) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [site.origin]})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


@pytest.fixture
def lab(linked: ApiAs, database: str) -> Lab:
    return make_lab(linked, database, admins=("owner",))


def queued(linked: ApiAs, lab: Lab, site: Site) -> dict[str, Any]:
    site.json(INFER, ANSWER)
    ok(linked(lab.people["owner"]).post(MODELS, json=draft(site, lab, name=NAME)))
    [run] = ok(lab_run(linked, lab, lab.project, lab.slides[0]))
    return run


def stage_plan(lab: Lab, site: Site, store: MemoryStore) -> Any:
    async def quick(step: StepRun) -> Mapping[str, Any]:
        await step.set_total(1)
        async with step.transaction() as connection:
            if 0 not in await step.done_units():
                await step.mark_unit(connection, 0)
        return {"units": 1}

    async def slide_of(step: StepRun) -> LabSlide:
        prefix = run_prefix(lab.tenant, lab.slides[0], step.job_id)
        return LabSlide(FlatReader(), SLIDE, prefix)

    async def no_pause(seconds: float) -> None:
        return None

    running = lab_model_running(
        slide_of,
        MasterKeyring.from_setting(TEST_MASTER_KEYS),
        policy_of([site.origin]),
        store,
        pause=no_pause,
    )
    return workflow({name: running if name == MODEL_STAGE else quick for name in STAGES})


def run_stage(database: str, lab: Lab, site: Site, store: MemoryStore) -> None:
    async def go(engine: Any) -> None:
        plan = stage_plan(lab, site, store)
        claimed = await claim_model_run(engine, "lab-worker", plan, lab.tenant)
        assert claimed is not None
        await run_model_run(engine, claimed, "lab-worker", machine="test")

    run_async(database, go)


def stored_text(database: str, lab: Lab) -> str:
    rows = [
        value
        for table in SCANNED
        for (value,) in owner(
            database,
            f"SELECT row_to_json(t)::text FROM {table} t WHERE t.tenant_id = '{lab.tenant}'",
        )
    ]
    return "\n".join(str(value) for value in rows)


def job_of(database: str, run: Mapping[str, Any]) -> tuple[object, ...]:
    [row] = owner(database, f"SELECT status, error_code FROM jobs WHERE id = '{run['id']}'")
    return row


def test_a_queued_lab_model_stage_stores_cells_and_regions_and_never_the_token(
    linked: ApiAs, lab: Lab, site: Site, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    run = queued(linked, lab, site)
    store = MemoryStore()
    run_stage(database, lab, site, store)
    assert job_of(database, run) == ("done", None)
    [(_, path, headers)] = site.requests
    assert (path, lowered(headers)["authorization"]) == (INFER, f"Bearer {TOKEN}")
    prefix = run_prefix(lab.tenant, lab.slides[0], uuid.UUID(run["id"]))
    cells = run_async(database, lambda _: read_chunk(store, tile_key(prefix, 0)))
    assert [cell.class_index for cell in cells] == [0, 0, 2]
    regions = owner(
        database,
        "SELECT number, class_index, ST_AsText(geometry) FROM result_objects "
        "JOIN result_sets ON result_sets.id = result_objects.result_set_id "
        f"WHERE result_sets.job_id = '{run['id']}' AND kind = 'region' ORDER BY number",
    )
    assert regions == [
        (1, 0, "POLYGON((10 10,210 10,210 210,10 210,10 10))"),
        (2, 0, "POLYGON((400 300,512 300,512 400,400 400,400 300))"),
    ]
    [(status, region_count)] = owner(
        database,
        f"SELECT status, region_count FROM result_sets WHERE job_id = '{run['id']}'",
    )
    assert (status, region_count) == ("ready", 2)
    [(output,)] = owner(
        database,
        "SELECT result::text FROM job_steps "
        f"WHERE job_id = '{run['id']}' AND name = '{MODEL_STAGE}'",
    )
    assert '"regions": 2' in str(output)
    assert '"regions_left_out": 1' in str(output)
    assert TOKEN not in stored_text(database, lab)
    assert all(TOKEN not in data.decode("latin-1") for data in store.objects.values())
    assert TOKEN not in caplog.text


def test_a_refusing_endpoint_fails_the_stage_and_never_leaks_the_opened_token(
    linked: ApiAs, lab: Lab, site: Site, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    run = queued(linked, lab, site)
    site.json(INFER, {"error": TOKEN}, status=503)
    store = MemoryStore()
    run_stage(database, lab, site, store)
    assert job_of(database, run) == ("failed", "lab-model-status")
    assert len(site.requests) == 3
    assert store.objects == {}
    assert TOKEN not in stored_text(database, lab)
    assert TOKEN not in caplog.text


def test_a_project_taken_off_the_model_list_fails_the_stage_before_any_call(
    linked: ApiAs, lab: Lab, site: Site, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    run = queued(linked, lab, site)
    owner(database, f"DELETE FROM lab_model_projects WHERE project_id = '{lab.project}'")
    store = MemoryStore()
    run_stage(database, lab, site, store)
    assert job_of(database, run) == ("failed", "lab-model-not-allowed")
    assert site.requests == []
    assert store.objects == {}
    assert TOKEN not in stored_text(database, lab)
    assert TOKEN not in caplog.text


def test_a_project_turned_clinical_without_a_tile_confirmation_fails_the_stage(
    linked: ApiAs, lab: Lab, site: Site, database: str
) -> None:
    run = queued(linked, lab, site)
    owner(database, f"UPDATE projects SET privacy_mode = 'clinical' WHERE id = '{lab.project}'")
    run_stage(database, lab, site, MemoryStore())
    assert job_of(database, run) == ("failed", "lab-model-tiles-unconfirmed")
    assert site.requests == []


def test_a_saved_model_gone_since_the_start_fails_with_lab_model_changed(
    linked: ApiAs, lab: Lab, site: Site, database: str
) -> None:
    run = queued(linked, lab, site)
    owner(database, f"UPDATE lab_models SET version = 'v9' WHERE tenant_id = '{lab.tenant}'")
    run_stage(database, lab, site, MemoryStore())
    assert job_of(database, run) == ("failed", "lab-model-changed")
    assert site.requests == []
