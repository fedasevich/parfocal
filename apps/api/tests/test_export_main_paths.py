import io
import json
import math
import os
import statistics
import subprocess
import time
import uuid
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from fixture_support import fixture_path
from storage_support import with_store
from test_annotations import make_slide
from test_large_result_imports import nearest_rank, remove_tenant_objects, worker
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.object_store import ObjectStore

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

MAIN_PATH_ANNOTATIONS = os.environ.get("PARFOCAL_MAIN_PATH_ANNOTATIONS")
MAIN_PATH_RUNS = int(os.environ.get("PARFOCAL_MAIN_PATH_RUNS", "20"))
BENCH_OUT = os.environ.get("PARFOCAL_BENCH_OUT")
SLIDE = "CMU-1-Small-Region.svs"
SLIDE_SIZE = (2220, 2967)
LEVEL = 0
TILE = 512
STATUS_POLL_SECONDS = 0.05
EXPORT_TIMEOUT_SECONDS = 600
WORKER_IDLE_EXIT_SECONDS = 600


def annotation_grid(count: int, width: int, height: int) -> dict[str, Any]:
    columns = math.ceil(math.sqrt(count * width / height))
    rows = math.ceil(count / columns)
    step_x, step_y = width / columns, height / rows
    side = 0.6 * min(step_x, step_y)
    features: list[dict[str, Any]] = []
    for index in range(count):
        x = (index % columns) * step_x + 0.2 * step_x
        y = (index // columns) * step_y + 0.2 * step_y
        ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"objectType": "annotation", "classification": {"name": "Tumour"}},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def stored_slide(database: str, tenant: uuid.UUID, project: uuid.UUID) -> uuid.UUID:
    slide = make_slide(database, tenant, project)
    path = fixture_path(SLIDE)
    key = f"t/{tenant}/s/{slide}/{SLIDE}"

    async def put(store: ObjectStore) -> None:
        await store.put_object(key, path.read_bytes(), "image/tiff")

    with_store(put)
    owner(
        database,
        f"UPDATE slides SET original_key = '{key}', file_bytes = {path.stat().st_size}, "
        f"width = {SLIDE_SIZE[0]}, height = {SLIDE_SIZE[1]} WHERE id = '{slide}'",
    )
    return slide


def signed_off_task(
    api: ApiAs, database: str, count: int
) -> tuple[uuid.UUID, MemberPrincipal, str, uuid.UUID]:
    workspace = make_workspace(database, {"owner": Role.RESEARCHER, "first": Role.REVIEWER})
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["first"], "reviewer")
    owner(
        database,
        "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
        f"VALUES ('{tenant}', '{project}', 1, 'Tumour', '#c80000')",
    )
    slide = stored_slide(database, tenant, project)
    task = ok(
        api(people["owner"]).post(
            f"/api/projects/{project}/review-tasks",
            json={
                "name": "Export main path",
                "kind": "annotate",
                "slide_ids": [str(slide)],
                "result_sets": [],
                "reviewer_ids": [str(people["first"].user_id)],
                "split": "everyone",
            },
        ),
        201,
    )["id"]
    layer = f"/api/review-tasks/{task}/slides/{slide}"
    imported = ok(
        api(people["first"]).post(
            f"{layer}/shared-layer/imports",
            json={"file_name": "grid.geojson", "content": annotation_grid(count, *SLIDE_SIZE)},
        ),
        201,
    )
    assert len(imported["objects"]) == count
    ok(api(people["first"]).post(f"{layer}/check"))
    ok(api(people["owner"]).post(f"{layer}/sign-off"))
    return tenant, people["owner"], str(task), slide


def geojson_export(api: ApiAs, who: MemberPrincipal, task: str) -> dict[str, Any]:
    started = time.perf_counter()
    response = api(who).get(f"/api/review-tasks/{task}/training-dataset")
    body = response.content
    seconds = time.perf_counter() - started
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        names = archive.namelist()
        features = sum(
            len(json.loads(archive.read(name))["features"])
            for name in names
            if name.endswith(".geojson")
        )
    return {"seconds": seconds, "bytes": len(body), "features": features}


def job_step_seconds(database: str, job: str) -> float:
    rows = owner(
        database,
        "SELECT extract(epoch FROM max(finished_at) - min(started_at)) FROM job_steps "
        f"WHERE job_id = '{job}'",
    )
    return float(str(rows[0][0]))


def coco_export(api: ApiAs, database: str, who: MemberPrincipal, task: str) -> dict[str, Any]:
    exports = f"/api/review-tasks/{task}/patch-exports"
    started = time.perf_counter()
    job = ok(
        api(who).post(exports, json={"level": LEVEL, "tile_size": TILE, "format": "coco"}), 202
    )["job_id"]
    state = "cutting"
    while state == "cutting" and time.perf_counter() - started < EXPORT_TIMEOUT_SECONDS:
        time.sleep(STATUS_POLL_SECONDS)
        state = ok(api(who).get(f"{exports}/{job}/status"))["state"]
    assert state == "done", state
    response = api(who).get(f"{exports}/{job}")
    body = response.content
    seconds = time.perf_counter() - started
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        coco = json.loads(archive.read("annotations.json"))
        skipped = json.loads(archive.read("manifest.json")).get("skipped", [])
    return {
        "skipped": skipped,
        "seconds": seconds,
        "step_seconds": job_step_seconds(database, job),
        "bytes": len(body),
        "images": len(coco["images"]),
        "annotations": len(coco["annotations"]),
    }


def summary(runs: list[dict[str, Any]]) -> dict[str, Any]:
    seconds = [run["seconds"] for run in runs]
    return {
        "runs": len(runs),
        "median_ms": statistics.median(seconds) * 1000,
        "p95_ms": nearest_rank(seconds, 0.95) * 1000,
        "min_ms": min(seconds) * 1000,
        "max_ms": max(seconds) * 1000,
        "samples": runs,
    }


def measured(export: Callable[[], dict[str, Any]]) -> list[dict[str, Any]]:
    export()
    return [export() for _ in range(MAIN_PATH_RUNS)]


@pytest.mark.skipif(
    MAIN_PATH_ANNOTATIONS is None, reason="set PARFOCAL_MAIN_PATH_ANNOTATIONS to a count"
)
def test_main_path_exports_of_a_signed_off_slide_after_a_warm_up(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    assert MAIN_PATH_ANNOTATIONS is not None
    count = int(MAIN_PATH_ANNOTATIONS)
    tenant, who, task, _ = signed_off_task(api, database, count)
    geojson = measured(lambda: geojson_export(api, who, task))
    process = worker(
        database,
        tenant,
        "export",
        tmp_path / "work",
        None,
        None,
        idle_exit=WORKER_IDLE_EXIT_SECONDS,
    )
    try:
        coco = measured(lambda: coco_export(api, database, who, task))
    finally:
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
    removed = remove_tenant_objects(tenant)
    report = {
        "annotations": count,
        "slide": SLIDE,
        "level": LEVEL,
        "tile_size": TILE,
        "geojson": summary(geojson),
        "coco": summary(coco),
        "objects_removed": removed,
    }
    print(json.dumps(report, default=str))
    if BENCH_OUT:
        Path(BENCH_OUT).write_text(json.dumps(report, indent=2))
    assert all(run["features"] == count for run in geojson)
    assert all(run["annotations"] >= count for run in coco)
