import uuid
from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_annotations import make_slide
from test_review_order import Ordered, ordered
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
HUMAN = {"type": "Polygon", "coordinates": [[[50, 50], [80, 50], [80, 80], [50, 80], [50, 50]]]}
ARROW = {"type": "LineString", "coordinates": [[0, 0], [30, 30]]}
CLASSES = ("Tumour", "Stroma", "Immune")
AI_CLASSES = {1: 0, 2: 0, 3: 0, 4: 1, 5: 1}


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def project_classes(database: str, o: Ordered) -> dict[str, str]:
    found: dict[str, str] = {}
    for key, name in enumerate(CLASSES, start=1):
        found[name] = str(
            owner(
                database,
                "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
                f"VALUES ('{o.tenant}', '{o.project}', {key}, '{name}', '#c8000{key}') "
                "RETURNING id",
            )[0][0]
        )
    return found


def ai_slide(database: str, o: Ordered, classes: dict[str, str]) -> tuple[uuid.UUID, str]:
    slide = make_slide(database, o.tenant, o.project)
    set_id = owner(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
        f"VALUES ('{o.tenant}', '{o.project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
    )[0][0]
    for position, name in enumerate(("Tumour", "Stroma")):
        owner(
            database,
            "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
            f"source_name, class_id) VALUES ('{o.tenant}', '{o.project}', '{set_id}', "
            f"{position}, '{name.lower()}', '{classes[name]}')",
        )
    for number, index in AI_CLASSES.items():
        owner(
            database,
            "INSERT INTO result_objects "
            "(tenant_id, result_set_id, kind, number, geometry, class_index) "
            f"VALUES ('{o.tenant}', '{set_id}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}0 0,{number}0 9,0 9,0 0))', 0), {index})",
        )
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', region_count = 5 WHERE id = '{set_id}'",
    )
    return slide, str(set_id)


def worked_task(api: ApiAs, database: str) -> tuple[Ordered, str, dict[str, str], dict[str, str]]:
    o = ordered(database, api)
    classes = project_classes(database, o)
    with_ai, set_id = ai_slide(database, o, classes)
    without_ai = make_slide(database, o.tenant, o.project)
    task = ok(
        api(o.people["owner"]).post(
            f"/api/projects/{o.project}/review-tasks",
            json={
                "name": "Fix the AI",
                "kind": "annotate",
                "slide_ids": [str(with_ai), str(without_ai)],
                "result_sets": [{"slide_id": str(with_ai), "result_set_id": set_id}],
                "reviewer_ids": [str(o.people[who].user_id) for who in ("first", "second")],
                "split": "everyone",
                "preset": "mixed",
            },
        ),
        201,
    )["id"]
    run_orders(database, o.tenant)

    def first() -> Any:
        return api(o.people["first"])

    def second() -> Any:
        return api(o.people["second"])

    layer = f"/api/review-tasks/{task}/slides/{with_ai}/shared-layer"
    ok(first().post(f"{layer}/ai/T1/confirm", json={}), 201)
    undone = ok(first().post(f"{layer}/ai/T2/confirm", json={}), 201)
    ok(first().delete(f"{layer}/ai/T2/confirm", params={"version": undone["version"]}), 204)
    ok(second().put(f"{layer}/ai/T3", json={"geometry": SQUARE}), 201)
    edited = ok(first().put(f"{layer}/ai/T4", json={"geometry": SQUARE}), 201)
    ok(
        second().delete(f"{layer}/objects/{edited['id']}", params={"version": edited["version"]}),
        204,
    )
    stroma = {"kind": "region", "geometry": HUMAN, "class_id": classes["Stroma"]}
    ok(second().post(f"{layer}/objects", json=stroma), 201)
    ok(first().post(f"{layer}/objects", json={"kind": "arrow", "geometry": ARROW}), 201)
    blank = f"/api/review-tasks/{task}/slides/{without_ai}/shared-layer"
    immune = {"kind": "region", "geometry": HUMAN, "class_id": classes["Immune"]}
    ok(first().post(f"{blank}/objects", json=immune), 201)
    ok(first().post(f"{blank}/objects", json=immune), 201)
    tumour = {"kind": "region", "geometry": HUMAN, "class_id": classes["Tumour"]}
    ok(second().post(f"{blank}/objects", json=tumour), 201)
    gone = ok(second().post(f"{blank}/objects", json=tumour), 201)
    ok(second().delete(f"{blank}/objects/{gone['id']}", params={"version": gone["version"]}), 204)
    first_id, second_id = o.people["first"].user_id, o.people["second"].user_id
    letters = (
        {"first": "A", "second": "B"} if first_id < second_id else {"first": "B", "second": "A"}
    )
    return o, task, classes, letters


def counts(found: dict[str, Any]) -> tuple[int, ...]:
    return tuple(
        found[key] for key in ("ai_objects", "confirmed", "edited", "deleted", "unchecked", "added")
    )


def by(found: dict[str, Any]) -> dict[str, tuple[int, int, int, int]]:
    return {
        person["letter"]: (
            person["confirmed"],
            person["edited"],
            person["deleted"],
            person["added"],
        )
        for person in found["by"]
    }


def test_the_evaluation_counts_how_two_experts_changed_the_ai(api: ApiAs, database: str) -> None:
    o, task, classes, letter = worked_task(api, database)
    a, b = letter["first"], letter["second"]
    body = ok(api(o.people["owner"]).get(f"/api/review-tasks/{task}/evaluation/ai-changes"))
    assert body["experts"] == [
        {"letter": "A", "assigned": True},
        {"letter": "B", "assigned": True},
    ]
    with_ai, without_ai = body["slides"]
    assert with_ai["result_set_id"] is not None
    assert [(row["class_name"], counts(row)) for row in with_ai["classes"]] == [
        ("Tumour", (3, 1, 1, 0, 1, 0)),
        ("Stroma", (2, 0, 0, 1, 1, 1)),
    ]
    assert by(with_ai["classes"][0]) == {a: (1, 0, 0, 0), b: (0, 1, 0, 0)}
    assert by(with_ai["classes"][1]) == {b: (0, 0, 1, 1)}
    assert counts(with_ai["total"]) == (5, 1, 1, 1, 2, 1)
    assert without_ai["result_set_id"] is None
    assert [(row["class_name"], counts(row)) for row in without_ai["classes"]] == [
        ("Tumour", (0, 0, 0, 0, 0, 1)),
        ("Immune", (0, 0, 0, 0, 0, 2)),
    ]
    assert by(without_ai["classes"][1]) == {a: (0, 0, 0, 2)}
    assert counts(without_ai["total"]) == (0, 0, 0, 0, 0, 3)
    assert [(row["class_name"], row["class_id"], counts(row)) for row in body["classes"]] == [
        ("Tumour", classes["Tumour"], (3, 1, 1, 0, 1, 1)),
        ("Stroma", classes["Stroma"], (2, 0, 0, 1, 1, 1)),
        ("Immune", classes["Immune"], (0, 0, 0, 0, 0, 2)),
    ]
    assert counts(body["total"]) == (5, 1, 1, 1, 2, 4)
    assert by(body["total"]) == {a: (1, 0, 0, 2), b: (0, 1, 1, 2)}


def test_the_ai_changes_agree_with_the_check_status(api: ApiAs, database: str) -> None:
    o, task, _, _ = worked_task(api, database)
    body = ok(api(o.people["owner"]).get(f"/api/review-tasks/{task}/evaluation/ai-changes"))
    slide = body["slides"][0]["slide_id"]
    status = ok(api(o.people["owner"]).get(f"/api/review-tasks/{task}/slides/{slide}/check-status"))
    assert status["check_progress"] == {
        "scope": 5,
        "checked": 3,
        "unchecked": 2,
        "confirmed": 1,
        "edited": 1,
        "deleted": 1,
    }
    total = body["slides"][0]["total"]
    assert total["ai_objects"] == status["check_progress"]["scope"]
    assert total["unchecked"] == status["check_progress"]["unchecked"]


def test_only_people_who_see_the_whole_annotate_task_get_the_ai_changes(
    api: ApiAs, database: str
) -> None:
    o, task, _, _ = worked_task(api, database)
    hidden = api(o.people["first"]).get(f"/api/review-tasks/{task}/evaluation/ai-changes")
    assert hidden.status_code == 403, hidden.text
    assert hidden.json()["code"] == "evaluation-hidden"
