import uuid
from collections.abc import Mapping
from typing import Any

import httpx2
import numpy as np
import pytest
from db_support import ApiAs
from nuclei_support import StainMaps, disks
from order_support import run_orders
from storage_support import TEST_STORAGE, with_store
from test_lab_model_stage import job_of
from test_model_runs import Lab, control, expire_lease, make_lab, ok, run_async, started
from workspace_support import owner

from parfocal_common.chunk_store import read_summary
from parfocal_common.jobs import Step, StepFunction, StepRun, Workflow
from parfocal_common.model_runs import STAGES
from parfocal_common.object_store import ObjectStore
from parfocal_common.outline_types import TYPER_CLASSES
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest import cell_import, matching
from parfocal_ml import cell_numbers
from parfocal_ml.nuclei_run_worker import drain_nuclei_runs, nuclei_run_workflow
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.tumor_map_worker import Drain
from parfocal_ml.typer import CLASS_CHANNELS

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

NUCLEI = {"detector": {"name": "pathosam-hovernext"}}
RADIUS = 9.0
MPP = 0.25
TISSUE = (200, 120, 170)
NEOPLASTIC = 1
WIDTH, HEIGHT = 1536, 1024
CENTRES = [(float(x), float(y)) for y in range(60, 1000, 80) for x in range(60, 1500, 80)]


class PixelReader:
    def __init__(self, rgb: np.ndarray) -> None:
        self.rgb = rgb

    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        out = np.full((height, width, 3), 255, np.uint8)
        top, left = max(0, y), max(0, x)
        bottom, right = min(self.rgb.shape[0], y + height), min(self.rgb.shape[1], x + width)
        if bottom > top and right > left:
            out[top - y : bottom - y, left - x : right - x] = self.rgb[top:bottom, left:right]
        return out


def disk_slide() -> SlideImage:
    rgb = disks(HEIGHT, WIDTH, CENTRES, RADIUS)
    rgb[(rgb == 240).all(axis=2)] = TISSUE
    return SlideImage(PixelReader(rgb), rgb[::16, ::16].copy(), 16.0, WIDTH, HEIGHT, MPP)


async def open_slide(tenant_id: uuid.UUID, slide_id: uuid.UUID, folder: str | None) -> SlideImage:
    return disk_slide()


def dark_is_neoplastic(rgb: np.ndarray) -> np.ndarray:
    dark = rgb.mean(axis=2) < 128
    class_map = np.zeros((CLASS_CHANNELS, *dark.shape), np.float32)
    class_map[0] = 0.1
    class_map[NEOPLASTIC] = np.where(dark, 0.8, 0.1)
    class_map[3] = np.where(dark, 0.1, 0.8)
    return class_map


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    made = make_lab(api, database)
    owner(database, f"UPDATE slides SET mpp_x = {MPP}, mpp_y = {MPP} WHERE id = '{made.slides[1]}'")
    return made


def drained(database: str, lab: Lab, last: StepFunction | None = None) -> int:
    async def no_sleep(seconds: float) -> None:
        return None

    async def go(engine: Any) -> int:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectResultStore(ObjectStore(TEST_STORAGE, http))
            plan = nuclei_run_workflow(
                open_slide, StainMaps(RADIUS), store, "L4", dark_is_neoplastic
            )
            if last is not None:
                steps = [Step(s.name, last) if s.name == STAGES[-1] else s for s in plan.steps]
                plan = Workflow(plan.kind, steps, plan.lease_seconds)
            drain = Drain(idle_exit_seconds=1.0, poll_seconds=1.0, tenant_id=lab.tenant)
            return await drain_nuclei_runs(engine, plan, "nuclei-worker", drain, no_sleep)

    return run_async(database, go)


def set_of(database: str, run: Mapping[str, Any]) -> tuple[Any, ...]:
    [row] = owner(
        database,
        "SELECT id, status, cell_count, error_code FROM result_sets "
        f"WHERE job_id = '{run['id']}' AND deleted_at IS NULL",
    )
    return row


def numbered_centres(lab: Lab, set_id: Any) -> dict[int, tuple[float, float]]:
    prefix = result_set_prefix(lab.tenant, lab.slides[1], uuid.UUID(str(set_id)))

    async def read(store: ObjectStore) -> Any:
        return await read_summary(ObjectResultStore(store), prefix)

    summary = with_store(read)
    assert list(summary.arrays["class"]) == [TYPER_CLASSES.index("tumor")] * len(summary)
    assert "probs" in summary.arrays
    return {
        int(number): (round(float(x)), round(float(y)))
        for number, x, y in zip(
            summary.numbers(), summary.arrays["x"], summary.arrays["y"], strict=True
        )
    }


def counter(database: str, lab: Lab) -> list[tuple[Any, ...]]:
    return owner(
        database,
        f"SELECT last FROM slide_counters WHERE slide_id = '{lab.slides[1]}' AND letter = 'C'",
    )


def class_counts(database: str, set_id: Any) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT source_name, object_count FROM result_set_classes "
        f"WHERE result_set_id = '{set_id}' ORDER BY position",
    )


def chunk_rows(database: str, set_id: Any) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT chunk, cell_count FROM result_chunks "
        f"WHERE result_set_id = '{set_id}' ORDER BY chunk",
    )


def test_a_nuclei_run_finishes_its_result_set_with_every_cell_typed_and_numbered(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, [lab.slides[1]], parameters=NUCLEI)
    assert drained(database, lab) == 1
    assert job_of(database, run) == ("done", None)
    set_id, status, cells, error = set_of(database, run)
    assert (status, error) == ("ready", None)
    assert cells == len(CENTRES)
    centres = numbered_centres(lab, set_id)
    assert sorted(centres) == list(range(1, len(CENTRES) + 1))
    assert sorted(centres.values()) == sorted((round(x), round(y)) for x, y in CENTRES)
    assert counter(database, lab) == [(len(CENTRES),)]
    assert class_counts(database, set_id) == [
        ("tumor", len(CENTRES)),
        ("stroma", 0),
        ("immune", 0),
        ("other", 0),
    ]
    assert sum(count for _, count in chunk_rows(database, set_id)) == len(CENTRES)

    [again] = started(api, lab, [lab.slides[1]], parameters=NUCLEI)
    assert drained(database, lab) == 1
    second, status, cells, _ = set_of(database, again)
    assert (status, cells) == ("ready", len(CENTRES))
    assert numbered_centres(lab, second) == centres
    assert counter(database, lab) == [(len(CENTRES),)]

    task = ok(
        api(lab.people["owner"]).post(
            f"/api/projects/{lab.project}/review-tasks",
            json={
                "name": "Review a nuclei run",
                "slide_ids": [str(lab.slides[1])],
                "result_sets": [{"slide_id": str(lab.slides[1]), "result_set_id": str(second)}],
                "reviewer_ids": [str(lab.people["reader"].user_id)],
                "split": "everyone",
                "scope": {"kind": "random-cells", "count": len(CENTRES), "seed": 7},
            },
        )
    )["id"]
    run_orders(database, lab.tenant)
    listed = ok(
        api(lab.people["reader"]).get(f"/api/review-tasks/{task}/slides/{lab.slides[1]}/objects")
    )
    objects = listed["objects"]
    assert len(objects) == len(CENTRES)
    assert {item["kind"] for item in objects} == {"cell"}
    assert sorted(item["number"] for item in objects) == sorted(centres)
    assert {item["class_name"].casefold() for item in objects} == {"tumor"}


class WorkerDiedError(RuntimeError):
    pass


async def dies(step: StepRun) -> Mapping[str, Any]:
    raise WorkerDiedError


def test_a_worker_that_dies_before_the_set_is_added_resumes_without_writing_twice(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(api, lab, [lab.slides[1]], parameters=NUCLEI)
    with pytest.raises(WorkerDiedError):
        drained(database, lab, dies)
    set_id, status, *_ = set_of(database, run)
    assert status == "importing"
    rows, numbers = chunk_rows(database, set_id), numbered_centres(lab, set_id)
    assert sum(count for _, count in rows) == len(CENTRES)
    expire_lease(database, run)
    assert drained(database, lab) == 1
    assert job_of(database, run) == ("done", None)
    assert set_of(database, run)[:3] == (set_id, "ready", len(CENTRES))
    assert chunk_rows(database, set_id) == rows
    assert numbered_centres(lab, set_id) == numbers
    assert class_counts(database, set_id)[0] == ("tumor", len(CENTRES))
    assert counter(database, lab) == [(len(CENTRES),)]


def test_a_run_that_fails_records_the_reason_on_its_result_set(
    api: ApiAs, lab: Lab, database: str
) -> None:
    [run] = started(
        api, lab, [lab.slides[1]], parameters={"detector": {"name": "hovernet", "version": "v0.9"}}
    )
    assert drained(database, lab) == 1
    assert job_of(database, run) == ("failed", "model-not-served")
    failed = set_of(database, run)
    assert failed[1:] == ("failed", 0, "model-not-served")
    ok(control(api, lab, run, "retry"))
    reopened = set_of(database, run)
    assert reopened[0] != failed[0]
    assert reopened[1:] == ("importing", 0, None)


def test_runs_number_cells_by_centre_exactly_as_an_import_does() -> None:
    generator = np.random.default_rng(17)
    known_xy = generator.uniform(0, 4000, (600, 2))
    known_numbers = generator.permutation(np.arange(1, 601))
    incoming = np.concatenate(
        [known_xy[:400] + generator.normal(0, 4, (400, 2)), generator.uniform(0, 4000, (300, 2))]
    )
    ours = cell_numbers.pair_centres(known_numbers, known_xy, incoming, 16.0)
    theirs = matching.pair_centres(known_numbers, known_xy, incoming, 16.0)
    assert np.array_equal(ours.numbers(601), theirs.numbers(601))
    assert ours.inherited == theirs.inherited
    repeated = np.array([3, 1, 3, 2], dtype=np.int64)
    centres = np.arange(8, dtype=np.float64).reshape(4, 2)
    for found, expected in zip(
        cell_numbers.latest_per_number(repeated, centres),
        cell_import.latest_per_number(repeated, centres),
        strict=True,
    ):
        assert np.array_equal(found, expected)
    assert cell_numbers.cell_distance(MPP) == matching.cell_distance(MPP)
