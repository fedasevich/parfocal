import uuid
from collections.abc import Mapping
from typing import Any

import numpy as np
import pytest
from db_support import ApiAs
from test_gpu_warm import FakeModal
from test_lab_model_stage import MemoryStore, job_of
from test_model_runs import Lab, control, make_lab, ok, read, run_async, started
from workspace_support import owner

from parfocal_common.model_runs import NUCLEI_POOL_FUNCTION, run_prefix, tile_key
from parfocal_ml.nuclei_run_worker import drain_nuclei_runs, nuclei_run_workflow
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.tumor_map_worker import Drain

pytestmark = pytest.mark.db

WIDTH, HEIGHT, DOWNSAMPLE = 2048, 1536, 32
NUCLEI = {"detector": {"name": "pathosam-hovernext"}}
MODEL = "model-running"


class FlatReader:
    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        return np.full((height, width, 3), (200, 120, 170), dtype=np.uint8)


class BlankMaps:
    def __init__(self) -> None:
        self.calls = 0

    def maps(self, rgb: np.ndarray) -> np.ndarray:
        self.calls += 1
        return np.zeros((3, *rgb.shape[:2]), np.float32)


def thumbnail(tissue_right: int) -> np.ndarray:
    image = np.full((HEIGHT // DOWNSAMPLE, WIDTH // DOWNSAMPLE, 3), 245, dtype=np.uint8)
    image[:, :tissue_right] = (190, 90, 160)
    return image


class FakeSlides:
    def __init__(self, tissue_right: int) -> None:
        self.tissue_right = tissue_right
        self.folders: list[str | None] = []

    async def __call__(
        self, tenant_id: uuid.UUID, slide_id: uuid.UUID, folder: str | None
    ) -> SlideImage:
        self.folders.append(folder)
        return SlideImage(
            FlatReader(), thumbnail(self.tissue_right), DOWNSAMPLE, WIDTH, HEIGHT, 0.25
        )


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


def drained(
    database: str,
    lab: Lab,
    slides: FakeSlides,
    model: BlankMaps,
    store: MemoryStore,
    typer: Any = None,
) -> int:
    async def no_sleep(seconds: float) -> None:
        return None

    async def go(engine: Any) -> int:
        plan = nuclei_run_workflow(slides, model, store, "L4", typer)
        drain = Drain(idle_exit_seconds=1.0, poll_seconds=1.0, tenant_id=lab.tenant)
        return await drain_nuclei_runs(engine, plan, "nuclei-worker", drain, no_sleep)

    return run_async(database, go)


def model_stage(database: str, run: Mapping[str, Any]) -> tuple[object, ...]:
    [row] = owner(
        database,
        "SELECT status, units_total FROM job_steps "
        f"WHERE job_id = '{run['id']}' AND name = 'model-running'",
    )
    return row


def gpu_seconds(database: str, run: Mapping[str, Any]) -> list[tuple[object, ...]]:
    return owner(database, f"SELECT model, gpu FROM gpu_usage WHERE job_id = '{run['id']}'")


def test_starting_a_parfocal_nuclei_run_wakes_the_best_detector_pool(api: ApiAs, lab: Lab) -> None:
    modal = FakeModal()
    api.app.state.gpu_pools = modal
    try:
        started(api, lab, parameters=NUCLEI)
    finally:
        del api.app.state.gpu_pools
    assert modal.spawned == [(NUCLEI_POOL_FUNCTION, {"kind": "detect"})]


def test_a_whole_slide_nuclei_run_reads_only_tissue_tiles_and_logs_its_gpu_time(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, parameters=NUCLEI)
    owner(
        database,
        "UPDATE slides SET original_key = 'imports/seed/case-7/original.svs' "
        f"WHERE id = '{lab.slides[0]}'",
    )
    store, model, slides = MemoryStore(), BlankMaps(), FakeSlides(tissue_right=20)
    assert drained(database, lab, slides, model, store) == 1
    assert slides.folders == ["imports/seed/case-7/"]
    assert job_of(database, run) == ("done", None)
    assert model_stage(database, run) == ("done", 1)
    prefix = run_prefix(lab.tenant, lab.slides[0], uuid.UUID(run["id"]))
    assert list(store.objects) == [tile_key(prefix, 0)]
    assert model.calls > 0
    assert gpu_seconds(database, run) == [("pathosam-hovernext", "L4")]
    [(status,)] = owner(database, f"SELECT status FROM result_sets WHERE job_id = '{run['id']}'")
    assert status == "ready"
    classes = owner(
        database,
        "SELECT c.source_name FROM result_set_classes c JOIN result_sets s "
        f"ON s.id = c.result_set_id WHERE s.job_id = '{run['id']}' ORDER BY c.position",
    )
    assert [name for (name,) in classes] == ["tumor", "stroma", "immune", "other"]
    stage = next(item for item in read(api, lab, run).json()["stages"] if item["name"] == MODEL)
    assert stage["typed"] is None
    assert stage["untyped_reason"] == "typer-weights-missing"


def even_classes(rgb: np.ndarray) -> np.ndarray:
    return np.full((6, *rgb.shape[:2]), 1 / 6, np.float32)


def test_a_typed_nuclei_run_counts_its_typed_cells_on_the_model_step(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, parameters=NUCLEI)
    store, model, slides = MemoryStore(), BlankMaps(), FakeSlides(tissue_right=20)
    assert drained(database, lab, slides, model, store, even_classes) == 1
    assert job_of(database, run) == ("done", None)
    stage = next(item for item in read(api, lab, run).json()["stages"] if item["name"] == MODEL)
    assert stage["typed"] == stage["objects"] == 0
    assert stage["untyped_reason"] is None


def test_a_run_with_no_tiles_planned_finishes_empty_without_a_gpu_call(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, parameters=NUCLEI)
    store, model = MemoryStore(), BlankMaps()
    assert drained(database, lab, FakeSlides(tissue_right=0), model, store) == 1
    assert job_of(database, run) == ("done", None)
    assert model_stage(database, run) == ("done", 0)
    assert store.objects == {}
    assert model.calls == 0
    assert gpu_seconds(database, run) == []


def test_a_parfocal_detector_without_a_worker_fails_with_a_code_instead_of_waiting(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, parameters={"detector": {"name": "hovernet", "version": "v0.9"}})
    model = BlankMaps()
    assert drained(database, lab, FakeSlides(tissue_right=20), model, MemoryStore()) == 1
    assert job_of(database, run) == ("failed", "model-not-served")
    assert model.calls == 0


def test_resuming_a_cancelled_nuclei_run_wakes_the_pool_again_and_cancelling_does_not(
    api: ApiAs, lab: Lab
) -> None:
    [run] = started(api, lab, parameters=NUCLEI)
    modal = FakeModal()
    api.app.state.gpu_pools = modal
    try:
        ok(control(api, lab, run, "cancel"))
        assert modal.spawned == []
        ok(control(api, lab, run, "resume"))
    finally:
        del api.app.state.gpu_pools
    assert modal.spawned == [(NUCLEI_POOL_FUNCTION, {"kind": "detect"})]
