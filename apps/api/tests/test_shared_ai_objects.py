import uuid
from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_check_options import annotate, made
from test_review_order import Ordered, ordered
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
REGIONS = [f"T{number}" for number in range(1, 7)]
CELLS = [f"C{number}" for number in range(1, 7)]


def checking(api: ApiAs, database: str) -> tuple[Ordered, str]:
    o = ordered(database, api)
    task = made(api, o, slide=0, preset="check-whole-slide-run")
    run_orders(database, o.tenant)
    return o, f"/api/review-tasks/{task}/slides/{o.slides[0]}/shared-layer"


def read(api: ApiAs, o: Ordered, layer: str, who: str = "first", **page: int) -> Any:
    response = api(o.people[who]).get(f"{layer}/ai", params=page)
    assert response.status_code == 200, response.text
    return response.json()


def tumor_class(database: str, o: Ordered) -> uuid.UUID:
    made_class = owner(
        database,
        "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
        f"VALUES ('{o.tenant}', '{o.project}', 7, 'Tumor', '#f87171') RETURNING id",
    )
    class_id = uuid.UUID(str(made_class[0][0]))
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{o.tenant}', '{o.project}', '{o.sets[0]}', 0, "
        f"'tumor', '{class_id}'); END $$",
    )
    return class_id


def test_the_read_lists_regions_then_cells_with_outlines_and_classes(
    api: ApiAs, database: str
) -> None:
    o, layer = checking(api, database)
    tumor = str(tumor_class(database, o))
    body = read(api, o, layer)
    assert (body["result_set_id"], body["result_name"]) == (str(o.sets[0]), "HoVer-NeXt")
    assert (body["total"], body["offset"]) == (12, 0)
    objects = {item["object"]: item for item in body["objects"]}
    assert [item["object"] for item in body["objects"]] == REGIONS + CELLS
    assert objects["T1"]["kind"] == "region"
    assert objects["T1"]["class_id"] == tumor
    assert objects["T2"]["class_id"] is None
    assert objects["T2"]["score"] == pytest.approx(40 / 255)
    assert objects["T1"]["score"] is None
    assert objects["T1"]["geometry"]["type"] == "Polygon"
    assert objects["C1"]["kind"] == "cell"
    assert objects["C1"]["class_id"] == tumor
    assert objects["C4"]["class_id"] is None
    assert objects["C1"]["score"] == pytest.approx(200 / 255)
    ring = objects["C1"]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]
    assert len(ring) == 5
    assert {item["check"] for item in body["objects"]} == {"unchecked"}
    assert read(api, o, layer, who="owner")["total"] == 12


def test_the_read_carries_the_check_state_of_each_copy(api: ApiAs, database: str) -> None:
    o, layer = checking(api, database)
    owner(
        database,
        "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
        f"VALUES ('{o.tenant}', '{o.slides[0]}', 'C', 6) "
        "ON CONFLICT (slide_id, letter) DO UPDATE SET last = 6",
    )
    first = api(o.people["first"])
    confirmed = first.post(f"{layer}/ai/T1/confirm", json={})
    assert confirmed.status_code == 201, confirmed.text
    cell = first.post(f"{layer}/ai/C2/confirm", json={"geometry": SQUARE})
    assert cell.status_code == 201, cell.text
    edited = first.put(f"{layer}/ai/T2", json={"geometry": SQUARE})
    assert edited.status_code == 201, edited.text
    deleted = first.put(f"{layer}/ai/T3", json={"deleted": True})
    assert deleted.status_code == 201, deleted.text
    undone = first.post(f"{layer}/ai/T4/confirm", json={}).json()
    gone = first.delete(f"{layer}/ai/T4/confirm", params={"version": undone["version"]})
    assert gone.status_code == 204, gone.text
    checks = {item["object"]: item["check"] for item in read(api, o, layer)["objects"]}
    assert checks == {
        "T1": "confirmed",
        "T2": "edited",
        "T3": "deleted",
        "T4": "unchecked",
        "T5": "unchecked",
        "T6": "unchecked",
        "C1": "unchecked",
        "C2": "confirmed",
        "C3": "unchecked",
        "C4": "unchecked",
        "C5": "unchecked",
        "C6": "unchecked",
    }
    sources = {
        item["source"]
        for item in first.get(layer).json()["objects"]
        if item["source"] is not None and item["deleted_at"] is None
    }
    assert sources == {"T1", "T2", "C2"}


def test_pages_cross_from_regions_into_cells_and_across_chunks(api: ApiAs, database: str) -> None:
    o, layer = checking(api, database)
    pages = [read(api, o, layer, offset=offset, limit=4) for offset in (0, 4, 8, 12)]
    assert [[item["object"] for item in page["objects"]] for page in pages] == [
        ["T1", "T2", "T3", "T4"],
        ["T5", "T6", "C1", "C2"],
        ["C3", "C4", "C5", "C6"],
        [],
    ]
    assert {page["total"] for page in pages} == {12}
    assert [item["object"] for item in read(api, o, layer, offset=7, limit=2)["objects"]] == [
        "C2",
        "C3",
    ]
    too_big = api(o.people["first"]).get(f"{layer}/ai", params={"limit": 5001})
    assert too_big.status_code == 422


def test_a_slide_with_no_result_set_answers_an_empty_list(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    created = annotate(api, o, slide=0, pinned=False)
    assert created.status_code == 201, created.text
    layer = f"/api/review-tasks/{created.json()['id']}/slides/{o.slides[0]}/shared-layer"
    body = read(api, o, layer)
    assert (body["result_set_id"], body["result_name"], body["total"]) == (None, None, 0)
    assert body["objects"] == []


def test_the_read_refuses_a_review_task_and_a_slide_outside_the_task(
    api: ApiAs, database: str
) -> None:
    o, layer = checking(api, database)
    review = api(o.people["first"]).get(
        f"/api/review-tasks/{o.task}/slides/{o.slides[0]}/shared-layer/ai"
    )
    assert (review.status_code, review.json()["code"]) == (409, "not-an-annotate-task")
    stranger = layer.replace(str(o.slides[0]), str(uuid.uuid4()))
    assert api(o.people["first"]).get(f"{stranger}/ai").status_code == 404
