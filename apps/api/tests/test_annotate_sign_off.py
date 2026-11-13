from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_check_options import check_all, made
from test_review_order import Ordered, ordered, result_set
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
POINT = {"type": "Point", "coordinates": [1, 2]}


def two_slides(api: ApiAs, o: Ordered, **extra: Any) -> str:
    response = api(o.people["owner"]).post(
        f"/api/projects/{o.project}/review-tasks",
        json={
            "name": "Annotate two slides",
            "kind": "annotate",
            "slide_ids": [str(slide) for slide in o.slides],
            "result_sets": [
                {"slide_id": str(slide), "result_set_id": str(result_set)}
                for slide, result_set in zip(o.slides, o.sets, strict=True)
            ],
            "reviewer_ids": [str(o.people[who].user_id) for who in ("first", "second")],
            "split": "everyone",
        }
        | extra,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def on_slide(o: Ordered, task: str, slide: int) -> str:
    return f"/api/review-tasks/{task}/slides/{o.slides[slide]}"


def post(api: ApiAs, o: Ordered, who: str, path: str, **body: Any) -> Any:
    return api(o.people[who]).post(path, json=body or None)


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json().get("code", "")


def checked_by(response: Any) -> dict[str, tuple[bool, bool]]:
    assert response.status_code == 200, response.text
    return {
        expert["user_id"]: (expert["checked_at"] is not None, expert["nothing_to_mark"])
        for expert in response.json()["experts"]
    }


def test_an_expert_checks_unchecks_and_marks_nothing_to_mark(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o)
    first, second = (str(o.people[who].user_id) for who in ("first", "second"))
    slide = on_slide(o, task, 1)
    checked = post(api, o, "first", f"{slide}/check")
    assert checked_by(checked) == {first: (True, False), second: (False, False)}
    assert problem(post(api, o, "first", f"{slide}/check")) == (409, "already-checked")
    assert problem(post(api, o, "third", f"{slide}/check"))[0] in {403, 404}
    unchecked = post(api, o, "first", f"{slide}/uncheck")
    assert checked_by(unchecked)[first] == (False, False)
    assert problem(post(api, o, "first", f"{slide}/uncheck")) == (409, "not-checked")
    empty = post(api, o, "first", f"{slide}/check", nothing_to_mark=True)
    assert checked_by(empty)[first] == (True, True)
    drawn = post(
        api,
        o,
        "second",
        f"{on_slide(o, task, 0)}/shared-layer/objects",
        kind="region",
        geometry=SQUARE,
    )
    assert drawn.status_code == 201, drawn.text
    refused = post(api, o, "second", f"{on_slide(o, task, 0)}/check", nothing_to_mark=True)
    assert problem(refused) == (409, "layer-not-empty")
    status = api(o.people["owner"]).get(f"{slide}/check-status")
    assert checked_by(status)[first] == (True, True)


def test_sign_off_waits_for_every_expert_and_locks_the_layer(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o)
    slide, other = on_slide(o, task, 1), on_slide(o, task, 0)
    layer = f"{slide}/shared-layer/objects"
    kept = post(api, o, "first", layer, kind="region", geometry=SQUARE)
    assert kept.status_code == 201, kept.text
    thread = post(
        api,
        o,
        "first",
        f"{slide}/threads",
        title="Margin",
        body="Please look at the margin.",
        anchor={"kind": "point", "geometry": POINT},
    )
    assert thread.status_code == 201, thread.text
    for who in ("first", "second"):
        assert post(api, o, who, f"{other}/check").status_code == 200
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert problem(post(api, o, "owner", f"{slide}/sign-off")) == (409, "experts-unchecked")
    assert post(api, o, "second", f"{slide}/check").status_code == 200
    assert problem(post(api, o, "second", f"{slide}/sign-off"))[0] == 403
    signed = post(api, o, "owner", f"{slide}/sign-off")
    assert signed.status_code == 200, signed.text
    assert signed.json()["signed_off_at"] is not None
    assert signed.json()["open_threads"] == 1
    assert problem(post(api, o, "owner", f"{slide}/sign-off")) == (409, "slide-already-signed-off")
    assert problem(post(api, o, "first", f"{slide}/uncheck")) == (409, "slide-signed-off")
    edit = {"version": 1, "geometry": SQUARE}
    object_path = f"{layer}/{kept.json()['id']}"
    refused = api(o.people["first"]).patch(object_path, json=edit)
    assert problem(refused) == (409, "slide-signed-off")
    assert problem(api(o.people["owner"]).patch(object_path, json=edit)) == (400, "reason-needed")
    changed = api(o.people["owner"]).patch(
        object_path, json=edit, params={"reason": "Outline follows the margin"}
    )
    assert changed.status_code == 200, changed.text
    log = owner(
        database,
        "SELECT object_id, change, reason, changed_by_user_id::text FROM evaluation_changes "
        f"WHERE task_id = '{task}'",
    )
    assert log == [
        (
            kept.json()["code"],
            "edited",
            "Outline follows the margin",
            str(o.people["owner"].user_id),
        )
    ]
    listed = api(o.people["owner"]).get(f"/api/review-tasks/{task}/evaluation-changes")
    assert listed.status_code == 200, listed.text
    assert [
        (item["object"], item["text"], item["reason"], item["by_user_id"])
        for item in listed.json()["changes"]
    ] == [
        (
            kept.json()["code"],
            "Edited",
            "Outline follows the margin",
            str(o.people["owner"].user_id),
        )
    ]
    hidden = api(o.people["first"]).get(f"/api/review-tasks/{task}/evaluation-changes")
    assert problem(hidden) == (403, "evaluation-hidden")
    states = api(o.people["owner"]).get(f"/api/review-tasks/{task}/states")
    by_slide = {item["slide_id"]: item["state"] for item in states.json()["slides"]}
    assert by_slide[str(o.slides[1])] == "signed-off"
    assert by_slide[str(o.slides[0])] != "signed-off"
    drawn = post(api, o, "first", f"{other}/shared-layer/objects", kind="region", geometry=SQUARE)
    assert drawn.status_code == 201, drawn.text


def test_sign_off_needs_the_check_scope_checked_when_the_rule_asks(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = made(api, o, slide=1, preset="check-whole-slide-run")
    run_orders(database, o.tenant)
    slide = on_slide(o, task, 1)
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    check_all(api, o, task, [1, 2, 3])
    assert problem(post(api, o, "owner", f"{slide}/sign-off")) == (409, "objects-unchecked")
    check_all(api, o, task, [4])
    signed = post(api, o, "owner", f"{slide}/sign-off")
    assert signed.status_code == 200, signed.text


def test_a_run_added_to_a_signed_off_slide_needs_the_owner_and_a_reason(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o)
    slide, other = on_slide(o, task, 1), on_slide(o, task, 0)
    for who in ("first", "second"):
        for path in (other, slide):
            assert post(api, o, who, f"{path}/check").status_code == 200
    assert post(api, o, "owner", f"{slide}/sign-off").status_code == 200
    later = result_set(database, o.tenant, o.project, o.slides[1], [(7, None, None, None)])
    runs, body = f"{slide}/runs", {"result_set_id": str(later)}
    assert problem(api(o.people["owner"]).post(runs, json=body)) == (400, "reason-needed")
    assert problem(api(o.people["first"]).post(runs, json=body))[1] == "slide-signed-off"
    added = api(o.people["owner"]).post(runs, json=body, params={"reason": "A newer run exists"})
    assert added.status_code == 200, added.text
    assert added.json()["run_set_ids"] == [str(later)]
    log = owner(
        database,
        "SELECT object_id, change, reason, changed_by_user_id::text FROM evaluation_changes "
        f"WHERE task_id = '{task}'",
    )
    assert log == [("Run", "added a run", "A newer run exists", str(o.people["owner"].user_id))]
    listed = api(o.people["owner"]).get(f"/api/review-tasks/{task}/evaluation-changes")
    assert [(item["text"], item["reason"]) for item in listed.json()["changes"]] == [
        ("Added a run", "A newer run exists")
    ]
