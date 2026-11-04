import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from test_annotations import make_class, make_slide
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import RecordedRealtime
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
WIDE = {"type": "Polygon", "coordinates": [[[0, 0], [30, 0], [30, 9], [0, 9], [0, 0]]]}
POINT = {"type": "Point", "coordinates": [40, 40]}


@dataclass(frozen=True)
class Layer:
    people: dict[str, MemberPrincipal]
    tenant: uuid.UUID
    project: uuid.UUID
    slide: uuid.UUID
    result_set: uuid.UUID
    tumor: uuid.UUID
    task: uuid.UUID
    live: RecordedRealtime

    @property
    def base(self) -> str:
        return f"/api/review-tasks/{self.task}/slides/{self.slide}/shared-layer"

    def user(self, label: str) -> str:
        return str(self.people[label].user_id)


def task_body(layer_slide: uuid.UUID, result_set: uuid.UUID, people: Any, kind: str) -> Any:
    body: dict[str, Any] = {
        "name": "Shared layer task",
        "slide_ids": [str(layer_slide)],
        "result_sets": [{"slide_id": str(layer_slide), "result_set_id": str(result_set)}],
        "reviewer_ids": [str(people["first"].user_id), str(people["second"].user_id)],
        "split": "everyone",
    }
    if kind == "annotate":
        return body | {"kind": "annotate", "scope": None}
    return body | {"scope": {"kind": "all-regions"}, "decision": {"style": "agree"}}


def shared_layer(api: ApiAs, database: str, kind: str = "annotate") -> Layer:
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
    slide = make_slide(database, tenant, project)
    tumor = make_class(database, tenant, project)
    result_set = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
                f"VALUES ('{tenant}', '{project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
            )[0][0]
        )
    )
    for number in (1, 2):
        owner(
            database,
            "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, score) "
            f"VALUES ('{tenant}', '{result_set}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}00 0,{number}00 50,0 50,0 0))', 0), 200)",
        )
    owner(
        database,
        "UPDATE result_sets SET status = 'ready', region_count = 2, cell_count = 5 "
        f"WHERE id = '{result_set}'",
    )
    owner(
        database,
        "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
        f"VALUES ('{tenant}', '{slide}', 'T', 2), ('{tenant}', '{slide}', 'C', 5)",
    )
    task = api(people["owner"]).post(
        f"/api/projects/{project}/review-tasks", json=task_body(slide, result_set, people, kind)
    )
    assert task.status_code == 201, task.text
    live = RecordedRealtime()
    api.app.state.realtime = live
    return Layer(
        people, tenant, project, slide, result_set, tumor, uuid.UUID(task.json()["id"]), live
    )


def ai_snapshot(database: str, layer: Layer) -> list[tuple[object, ...]]:
    objects = owner(
        database,
        "SELECT kind, number, ST_AsText(geometry), class_index, score FROM result_objects "
        f"WHERE result_set_id = '{layer.result_set}' ORDER BY kind, number",
    )
    header = owner(
        database,
        "SELECT status, name, region_count, cell_count, updated_at FROM result_sets "
        f"WHERE id = '{layer.result_set}'",
    )
    return objects + header


def draw(api: ApiAs, layer: Layer, who: str, body: dict[str, Any]) -> Any:
    return api(layer.people[who]).post(f"{layer.base}/objects", json=body)


def change(api: ApiAs, layer: Layer, who: str, object_id: str, body: dict[str, Any]) -> Any:
    return api(layer.people[who]).patch(f"{layer.base}/objects/{object_id}", json=body)


def change_ai(api: ApiAs, layer: Layer, who: str, object_id: str, body: dict[str, Any]) -> Any:
    return api(layer.people[who]).put(f"{layer.base}/ai/{object_id}", json=body)


def read(api: ApiAs, layer: Layer, who: str = "first") -> Any:
    response = api(layer.people[who]).get(layer.base)
    assert response.status_code == 200, response.text
    return response.json()


def test_two_experts_edit_one_layer(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    made = draw(api, layer, "first", {"kind": "region", "geometry": SQUARE})
    assert made.status_code == 201, made.text
    drawn = made.json()
    assert (drawn["code"], drawn["origin"], drawn["source"], drawn["version"]) == (
        "T3+",
        "human",
        None,
        1,
    )
    assert drawn["created_by_user_id"] == drawn["changed_by_user_id"] == layer.user("first")
    retyped = change(
        api, layer, "second", drawn["id"], {"version": 1, "class_id": str(layer.tumor)}
    )
    assert retyped.status_code == 200, retyped.text
    assert (retyped.json()["version"], retyped.json()["class_id"]) == (2, str(layer.tumor))
    assert retyped.json()["created_by_user_id"] == layer.user("first")
    assert retyped.json()["changed_by_user_id"] == layer.user("second")
    draw(api, layer, "second", {"kind": "cell", "geometry": POINT})
    for who in ("first", "second", "owner"):
        seen = read(api, layer, who)
        assert seen["result_set_id"] == str(layer.result_set)
        assert [(o["code"], o["created_by_user_id"]) for o in seen["objects"]] == [
            ("C6+", layer.user("second")),
            ("T3+", layer.user("first")),
        ]
    gone = api(layer.people["second"]).delete(
        f"{layer.base}/objects/{drawn['id']}", params={"version": 2}
    )
    assert gone.status_code == 204, gone.text
    assert [o["code"] for o in read(api, layer)["objects"]] == ["C6+"]


def test_only_assigned_experts_edit_the_layer(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    refused = draw(api, layer, "owner", {"kind": "region", "geometry": SQUARE})
    assert (refused.status_code, refused.json()["code"]) == (403, "not-assigned")
    refused_ai = change_ai(api, layer, "owner", "T1", {"deleted": True})
    assert refused_ai.json()["code"] == "not-assigned"
    unseen = draw(api, layer, "third", {"kind": "region", "geometry": SQUARE})
    assert unseen.status_code == 404
    assert api(layer.people["third"]).get(layer.base).status_code == 404


def test_an_ai_object_edited_and_one_deleted_leave_the_result_set_unchanged(
    api: ApiAs, database: str
) -> None:
    layer = shared_layer(api, database)
    before = ai_snapshot(database, layer)
    edited = change_ai(api, layer, "first", "T1", {"geometry": WIDE})
    assert edited.status_code == 201, edited.text
    assert (edited.json()["origin"], edited.json()["source"], edited.json()["code"]) == (
        "ai-edited",
        "T1",
        "T3+",
    )
    assert edited.json()["geometry"] == WIDE
    deleted = change_ai(api, layer, "second", "T2", {"deleted": True})
    assert deleted.status_code == 201, deleted.text
    mark = deleted.json()
    assert (mark["origin"], mark["source"], mark["deleted_at"] is not None) == (
        "ai-edited",
        "T2",
        True,
    )
    assert mark["geometry"]["coordinates"][0][1] == [200, 0]
    retyped_cell = change_ai(
        api, layer, "first", "C4", {"class_id": str(layer.tumor), "geometry": POINT}
    )
    assert (retyped_cell.json()["source"], retyped_cell.json()["code"]) == ("C4", "C6+")
    no_shape = change_ai(api, layer, "first", "C5", {"deleted": True})
    assert (no_shape.status_code, no_shape.json()["code"]) == (400, "cell-shape-needed")
    unknown = change_ai(api, layer, "first", "T9", {"deleted": True})
    assert (unknown.status_code, unknown.json()["code"]) == (404, "unknown-object")
    seen = read(api, layer, "second")
    assert [(o["source"], o["deleted_at"] is not None) for o in seen["objects"]] == [
        ("C4", False),
        ("T1", False),
        ("T2", True),
    ]
    assert ai_snapshot(database, layer) == before


def test_a_second_copy_of_an_ai_object_answers_the_current_copy(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    first = change_ai(api, layer, "first", "T1", {"class_id": str(layer.tumor)}).json()
    late = change_ai(api, layer, "second", "T1", {"deleted": True})
    assert (late.status_code, late.json()["code"]) == (409, "annotation-changed")
    assert late.json()["current"]["id"] == first["id"]
    assert late.json()["current"]["version"] == 1


def test_a_stale_save_is_refused_with_the_current_object(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    drawn = draw(api, layer, "first", {"kind": "region", "geometry": SQUARE}).json()
    assert change(api, layer, "first", drawn["id"], {"version": 1, "geometry": WIDE}).is_success
    stale = change(api, layer, "second", drawn["id"], {"version": 1, "class_id": None})
    assert (stale.status_code, stale.json()["code"]) == (409, "annotation-changed")
    current = stale.json()["current"]
    assert (current["id"], current["version"], current["geometry"]) == (drawn["id"], 2, WIDE)
    assert current["changed_by_user_id"] == layer.user("first")
    stale_delete = api(layer.people["second"]).delete(
        f"{layer.base}/objects/{drawn['id']}", params={"version": 1}
    )
    assert stale_delete.json()["current"]["version"] == 2


def test_the_history_of_an_object_names_who_changed_it(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    copied = change_ai(api, layer, "first", "T1", {"geometry": SQUARE}).json()
    change(api, layer, "second", copied["id"], {"version": 1, "class_id": str(layer.tumor)})
    api(layer.people["first"]).delete(f"{layer.base}/objects/{copied['id']}", params={"version": 2})
    history = api(layer.people["owner"]).get(f"{layer.base}/objects/{copied['id']}/history")
    assert history.status_code == 200, history.text
    assert [(v["version"], v["change"], v["changed_by_user_id"]) for v in history.json()] == [
        (1, "edited", layer.user("first")),
        (2, "edited", layer.user("second")),
        (3, "deleted", layer.user("first")),
    ]
    assert history.json()[1]["class_id"] == str(layer.tumor)


def test_each_change_goes_out_on_the_task_channel(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    drawn = draw(api, layer, "first", {"kind": "region", "geometry": SQUARE}).json()
    change(api, layer, "second", drawn["id"], {"version": 1, "geometry": WIDE})
    copied = change_ai(api, layer, "second", "T1", {"deleted": True}).json()
    api(layer.people["first"]).delete(f"{layer.base}/objects/{drawn['id']}", params={"version": 2})
    change(api, layer, "second", drawn["id"], {"version": 1, "geometry": SQUARE})
    room = f"task:{layer.task}"
    expected = [drawn["id"], drawn["id"], copied["id"], drawn["id"]]
    assert [
        (tenant, rooms, event["kind"], event["ids"])
        for tenant, rooms, event in layer.live.published
    ] == [
        (
            layer.tenant,
            [room],
            "layer.object-changed",
            {"task": str(layer.task), "slide": str(layer.slide), "annotation": annotation},
        )
        for annotation in expected
    ]


def test_a_review_task_has_no_shared_layer(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database, kind="review")
    refusals = [
        api(layer.people["first"]).get(layer.base),
        draw(api, layer, "first", {"kind": "region", "geometry": SQUARE}),
        change_ai(api, layer, "first", "T1", {"deleted": True}),
    ]
    assert [(r.status_code, r.json()["code"]) for r in refusals] == [
        (409, "not-an-annotate-task")
    ] * 3
