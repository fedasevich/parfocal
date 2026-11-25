from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import POINT, Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

LINE = {"type": "LineString", "coordinates": [[10, 10], [60, 40]]}


def draw(api: ApiAs, r: Review, who: str, body: dict[str, Any]) -> Any:
    response = api(r.people[who]).post(f"{r.base}/added", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def note(api: ApiAs, r: Review) -> Any:
    return draw(api, r, "first", {"kind": "text", "geometry": POINT, "text": "Look here"})


def test_a_note_arrow_and_ruler_stay_with_the_task_and_only_their_author_sees_them(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    made = [
        note(api, r),
        draw(api, r, "first", {"kind": "arrow", "geometry": LINE}),
        draw(api, r, "first", {"kind": "measurement", "geometry": LINE}),
    ]
    assert [item["task_id"] for item in made] == [str(r.task)] * 3
    layer = api(r.people["first"]).get(f"{r.base}/layer").json()
    assert sorted(item["kind"] for item in layer["marks"]) == ["arrow", "measurement", "text"]
    assert (layer["added"], layer["summary"]["added"]) == ([], 0)
    assert next(m for m in layer["marks"] if m["kind"] == "text")["text"] == "Look here"
    second = api(r.people["second"])
    assert second.get(f"/api/slides/{r.slide}/annotations").json() == []
    one = f"/api/slides/{r.slide}/annotations/{made[0]['id']}"
    assert second.get(one).status_code == 404
    refused = second.get(f"{r.base}/layer", params={"reviewer_id": str(r.people["first"].user_id)})
    assert refused.status_code in (403, 404)
    own = second.get(f"/api/slides/{r.slide}/export", params={"task_id": str(r.task)})
    assert own.status_code == 200, own.text
    assert own.json()["features"] == []
    mine = api(r.people["first"]).get(
        f"/api/slides/{r.slide}/export", params={"task_id": str(r.task)}
    )
    kinds = sorted(f["properties"]["parfocal"]["kind"] for f in mine.json()["features"])
    assert kinds == ["arrow", "measurement", "text"]


def test_layer_groups_never_show_a_hidden_shape_and_keep_it_when_another_reviewer_saves(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    made = note(api, r)
    groups = f"/api/slides/{r.slide}/layer-groups"
    item = {"annotation_id": made["id"], "name": "Mine", "hidden": True, "locked": False, "rank": 1}
    body = {
        "groups": [{"id": 1, "name": "Mine"}],
        "members": [{"annotation_id": made["id"], "group_id": 1}],
        "items": [item],
    }
    first = api(r.people["first"]).put(groups, json=body).json()
    assert first["members"] == body["members"]
    assert first["items"] == [{**item, "rank": 1.0}]
    second = api(r.people["second"])
    assert second.get(groups).json()["members"] == []
    assert second.get(groups).json()["items"] == []
    saved = second.put(groups, json={"groups": [{"id": 1, "name": "Mine"}], "members": []})
    assert saved.json()["members"] == []
    assert saved.json()["items"] == []
    mine = api(r.people["first"]).get(groups).json()
    assert mine["members"] == body["members"]
    assert mine["items"] == [{**item, "rank": 1.0}]


@pytest.mark.parametrize("closing", ["signed_off_at", "withdrawn_at"])
def test_nothing_in_a_task_changes_after_sign_off_or_withdrawal(
    api: ApiAs, database: str, closing: str
) -> None:
    r = review(api, database)
    made = note(api, r)
    one = f"/api/slides/{r.slide}/annotations/{made['id']}"
    assert api(r.people["first"]).delete(one, params={"version": 1}).status_code == 204
    owner(database, f"UPDATE review_tasks SET {closing} = now() WHERE id = '{r.task}'")
    code = "task-signed-off" if closing == "signed_off_at" else "task-withdrawn"
    for who in ("first", "owner"):
        person = api(r.people[who])
        restored = person.post(f"{one}/restore", json={"version": 2})
        changed = person.patch(one, json={"version": 2, "text": "Changed"})
        removed = person.delete(one, params={"version": 2})
        for response in (restored, changed, removed):
            assert (response.status_code, response.json()["code"]) == (409, code), response.text
