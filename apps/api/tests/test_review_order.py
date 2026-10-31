import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from chunk_support import Cell, chunk_bytes
from db_support import ApiAs
from test_annotations import make_slide
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.result_store import LocalResultStore
from parfocal_common.scope import sample

pytestmark = pytest.mark.db

type Region = tuple[int, int | None, int | None, str | None]

SCORED: list[Region] = [
    (1, 0, None, "{230,25}"),
    (2, None, 40, None),
    (3, 1, None, "{100,155}"),
    (4, None, None, None),
    (5, None, 155, None),
    (6, None, None, None),
]
UNSCORED: list[Region] = [(number, None, None, None) for number in (1, 2, 3, 4)]
TYPED: list[Cell] = [
    (1, 0, 200, 100, 100),
    (2, 1, 20, 300, 100),
    (3, 0, 10, 500, 500),
    (4, 255, 30, 700, 700),
]
TYPED_PROBS = [30, 225, 100, 155, 240, 15, 128, 127]
IMPORTED: list[Cell] = [(5, 0, 5, 2100, 100), (6, 1, 250, 2300, 100)]
CELL_CERTAINTY = {"C1": 30, "C2": 155, "C3": 240, "C4": None, "C5": None, "C6": None}
ROI = "POLYGON((25 -5,400 -5,400 400,25 400,25 -5))"
ZONE = "POLYGON((450 450,800 450,800 800,450 800,450 450))"


@dataclass(frozen=True)
class Ordered:
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slides: list[uuid.UUID]
    sets: list[uuid.UUID]
    store: LocalResultStore
    task: uuid.UUID


def sql(value: object) -> str:
    return "NULL" if value is None else f"'{value}'" if isinstance(value, str) else str(value)


def chunk_key(set_id: uuid.UUID, chunk: int) -> str:
    return f"cells/{set_id}/chunk-{chunk:05}.pfc"


def add_chunk(
    database: str, tenant: uuid.UUID, set_id: uuid.UUID, chunk: int, cells: list[Cell]
) -> None:
    owner(
        database,
        "INSERT INTO result_chunks (tenant_id, result_set_id, chunk, x, y, width, height, "
        f"cell_count, vertex_count, object_key) VALUES ('{tenant}', '{set_id}', {chunk}, "
        f"{chunk * 2048}, 0, 2048, 2048, {len(cells)}, {4 * len(cells)}, "
        f"'{chunk_key(set_id, chunk)}')",
    )


def result_set(
    database: str,
    tenant: uuid.UUID,
    project: uuid.UUID,
    slide: uuid.UUID,
    regions: list[Region],
    store: LocalResultStore | None = None,
) -> uuid.UUID:
    set_id = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
                f"VALUES ('{tenant}', '{project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
            )[0][0]
        )
    )
    for number, class_index, score, probabilities in regions:
        owner(
            database,
            "INSERT INTO result_objects "
            "(tenant_id, result_set_id, kind, number, geometry, class_index, score, probabilities) "
            f"VALUES ('{tenant}', '{set_id}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}0 0,{number}0 9,0 9,0 0))', 0), "
            f"{sql(class_index)}, {sql(score)}, {sql(probabilities)})",
        )
    owner(
        database,
        "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, score) "
        f"VALUES ('{tenant}', '{set_id}', 'zone', 1, ST_GeomFromText('{ZONE}', 0), 1)",
    )
    if store is not None:
        add_chunk(database, tenant, set_id, 0, TYPED)
        add_chunk(database, tenant, set_id, 1, IMPORTED)
        store.put(chunk_key(set_id, 0), chunk_bytes(TYPED, TYPED_PROBS))
        store.put(chunk_key(set_id, 1), chunk_bytes(IMPORTED, None))
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', region_count = {len(regions)}, zone_count = 1 "
        f"WHERE id = '{set_id}'",
    )
    return set_id


def create_task(api: ApiAs, o: Ordered, scope: dict[str, Any] | None = None) -> Any:
    return api(o.people["owner"]).post(
        f"/api/projects/{o.project}/review-tasks",
        json={
            "name": "Least sure first",
            "slide_ids": [str(slide) for slide in o.slides],
            "result_sets": [
                {"slide_id": str(slide), "result_set_id": str(set_id)}
                for slide, set_id in zip(o.slides, o.sets, strict=True)
            ],
            "reviewer_ids": [str(o.people[who].user_id) for who in ("first", "second")],
            "split": "everyone",
            "scope": scope or {"kind": "all-regions"},
        },
    )


def made(api: ApiAs, o: Ordered, scope: dict[str, Any] | None = None) -> uuid.UUID:
    task = create_task(api, o, scope)
    assert task.status_code == 201, task.text
    return uuid.UUID(task.json()["id"])


def ordered(database: str, api: ApiAs, tmp_path: Path) -> Ordered:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "first": Role.REVIEWER,
            "second": Role.REVIEWER,
            "third": Role.REVIEWER,
        },
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    for label in ("first", "second", "third"):
        join_project(database, project, people[label], "reviewer")
    slides = [make_slide(database, tenant, project) for _ in range(2)]
    store = LocalResultStore(tmp_path)
    api.app.results = store
    sets = [
        result_set(database, tenant, project, slides[0], SCORED, store),
        result_set(database, tenant, project, slides[1], UNSCORED),
    ]
    owner(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, kind, number, geometry) "
        f"VALUES ('{tenant}', '{project}', '{slides[0]}', 'roi', 1, ST_GeomFromText('{ROI}', 0))",
    )
    draft = Ordered(people, project, slides, sets, store, uuid.uuid4())
    return Ordered(people, project, slides, sets, store, made(api, draft))


def order_of(
    api: ApiAs, o: Ordered, who: str, slide: uuid.UUID, task: uuid.UUID, **page: int
) -> Any:
    return api(o.people[who]).get(f"/api/review-tasks/{task}/slides/{slide}/order", params=page)


def objects(api: ApiAs, o: Ordered, who: str, task: uuid.UUID, slide: int = 0) -> list[str]:
    response = order_of(api, o, who, o.slides[slide], task)
    assert response.status_code == 200, response.text
    return [item["object"] for item in response.json()["objects"]]


def shared(api: ApiAs, o: Ordered, task: uuid.UUID, slide: int = 0) -> list[str]:
    first = objects(api, o, "first", task, slide)
    assert objects(api, o, "second", task, slide) == first
    assert objects(api, o, "owner", task, slide) == first
    return first


def test_two_reviewers_get_the_same_least_sure_first_order(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    o = ordered(database, api, tmp_path)
    regions = shared(api, o, o.task)
    assert regions[:4] == ["T2", "T3", "T5", "T1"]
    assert sorted(regions[4:]) == ["T4", "T6"]
    assert sorted(shared(api, o, o.task, slide=1)) == ["T1", "T2", "T3", "T4"]
    body = order_of(api, o, "first", o.slides[0], o.task).json()
    assert (body["task_id"], body["slide_id"], body["total"]) == (str(o.task), str(o.slides[0]), 6)
    assert body["objects"][0] == {"object": "T2", "kind": "region", "number": 2}


def test_random_cells_order_only_the_sample(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    task = made(api, o, {"kind": "random-cells", "count": 3})
    seed = int(
        str(owner(database, f"SELECT scope_seed FROM review_tasks WHERE id = '{task}'")[0][0])
    )
    picked = [f"C{number}" for number in sample(range(1, 7), 3, seed, str(o.slides[0]))]
    order = shared(api, o, task)
    assert sorted(order) == sorted(picked)
    scored = sorted((value, name) for name in picked if (value := CELL_CERTAINTY[name]) is not None)
    assert order[: len(scored)] == [name for _, name in scored]
    assert objects(api, o, "first", task, slide=1) == []


def test_cells_below_a_score_filter_on_the_detection_score(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    o = ordered(database, api, tmp_path)
    task = made(api, o, {"kind": "cells-below-score", "score": 0.1})
    assert shared(api, o, task) == ["C2", "C3", "C5"]


def test_inside_rois_mixes_regions_and_cells(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    task = made(api, o, {"kind": "inside-rois"})
    order = shared(api, o, task)
    assert order[:4] == ["C1", "C2", "T3", "T5"]
    assert sorted(order[4:]) == ["T4", "T6"]


def test_unsure_zones_order_the_cells_inside_zones(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    o = ordered(database, api, tmp_path)
    task = made(api, o, {"kind": "unsure-zones"})
    assert shared(api, o, task) == ["C3", "C4"]


def test_the_order_comes_in_pages(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    whole = objects(api, o, "first", o.task)
    page = order_of(api, o, "first", o.slides[0], o.task, offset=2, limit=3).json()
    assert (page["total"], page["offset"]) == (6, 2)
    assert [item["object"] for item in page["objects"]] == whole[2:5]
    past = order_of(api, o, "first", o.slides[0], o.task, offset=10).json()
    assert (past["total"], past["objects"]) == (6, [])
    assert order_of(api, o, "first", o.slides[0], o.task, limit=0).status_code == 422


def test_someone_without_the_slide_gets_no_order(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    assert order_of(api, o, "third", o.slides[0], o.task).status_code == 404
    assert order_of(api, o, "first", uuid.uuid4(), o.task).status_code == 404


def test_a_scope_change_rebuilds_the_order(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    changed = api(o.people["owner"]).patch(
        f"/api/review-tasks/{o.task}", json={"scope": {"kind": "unsure-zones"}}
    )
    assert changed.status_code == 200, changed.text
    assert shared(api, o, o.task) == ["C3", "C4"]
    renamed = api(o.people["owner"]).patch(f"/api/review-tasks/{o.task}", json={"name": "Again"})
    assert renamed.status_code == 200
    assert shared(api, o, o.task) == ["C3", "C4"]


def test_a_missing_cell_file_refuses_the_task(api: ApiAs, database: str, tmp_path: Path) -> None:
    o = ordered(database, api, tmp_path)
    (tmp_path / chunk_key(o.sets[0], 1)).unlink()
    refused = create_task(api, o, {"kind": "cells-below-score", "score": 0.1})
    assert (refused.status_code, refused.json()["code"]) == (409, "result-files-missing")
    assert create_task(api, o).status_code == 201


def test_a_recalibration_leaves_a_running_task_unchanged(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    o = ordered(database, api, tmp_path)
    task = made(api, o, {"kind": "inside-rois"})
    regions, mixed = shared(api, o, o.task), shared(api, o, task)
    owner(
        database,
        "UPDATE result_objects SET probabilities = '{5,250}' "
        f"WHERE result_set_id = '{o.sets[0]}' AND kind = 'region' AND number = 1",
    )
    owner(
        database,
        "UPDATE result_objects SET score = 250 "
        f"WHERE result_set_id = '{o.sets[0]}' AND kind = 'region' AND number = 2",
    )
    recalibrated = [250, 5, 100, 155, 240, 15, 128, 127]
    o.store.put(chunk_key(o.sets[0], 0), chunk_bytes(TYPED, recalibrated))
    assert shared(api, o, o.task) == regions
    assert shared(api, o, task) == mixed
    same = api(o.people["owner"]).patch(
        f"/api/review-tasks/{task}", json={"name": "Renamed", "scope": {"kind": "inside-rois"}}
    )
    assert same.status_code == 200, same.text
    assert shared(api, o, task) == mixed
    assert shared(api, o, made(api, o))[:4] == ["T1", "T3", "T5", "T2"]
    later = shared(api, o, made(api, o, {"kind": "inside-rois"}))
    assert later[:4] == ["C2", "T3", "T5", "C1"]
