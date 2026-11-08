from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_check_options import made
from test_review_order import Ordered, ordered

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}


def checking(api: ApiAs, database: str, preset: str = "check-whole-slide-run") -> Any:
    o = ordered(database, api)
    task = made(api, o, slide=1, preset=preset)
    run_orders(database, o.tenant)
    return o, f"/api/review-tasks/{task}/slides/{o.slides[1]}"


def progress(api: ApiAs, o: Ordered, slide: str) -> dict[str, int]:
    response = api(o.people["first"]).get(f"{slide}/check-status")
    assert response.status_code == 200, response.text
    found = response.json()["check_progress"]
    assert found is not None
    return found


def confirm(api: ApiAs, o: Ordered, slide: str, number: int) -> Any:
    return api(o.people["first"]).post(f"{slide}/shared-layer/ai/T{number}/confirm", json={})


def undo(api: ApiAs, o: Ordered, slide: str, number: int, version: int) -> Any:
    return api(o.people["first"]).delete(
        f"{slide}/shared-layer/ai/T{number}/confirm", params={"version": version}
    )


def layer_sources(api: ApiAs, o: Ordered, slide: str) -> dict[str, tuple[str, bool]]:
    response = api(o.people["first"]).get(f"{slide}/shared-layer")
    assert response.status_code == 200, response.text
    return {
        item["source"]: (item["origin"], item["deleted_at"] is not None)
        for item in response.json()["objects"]
        if item["source"] is not None
    }


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json().get("code", "")


def test_a_confirm_keeps_the_ai_geometry_and_counts_as_checked(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    assert progress(api, o, slide) == {
        "scope": 4,
        "checked": 0,
        "unchecked": 4,
        "confirmed": 0,
        "edited": 0,
        "deleted": 0,
    }
    confirmed = confirm(api, o, slide, 1)
    assert confirmed.status_code == 201, confirmed.text
    body = confirmed.json()
    assert (body["origin"], body["source"], body["class_id"]) == ("ai-confirmed", "T1", None)
    assert body["geometry"]["type"] == "Polygon"
    assert layer_sources(api, o, slide) == {"T1": ("ai-confirmed", False)}
    assert progress(api, o, slide)["confirmed"] == 1
    assert progress(api, o, slide)["checked"] == 1
    assert problem(confirm(api, o, slide, 1)) == (409, "annotation-changed")


def test_undo_of_a_confirm_makes_the_object_unchecked_again(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    first = confirm(api, o, slide, 1).json()
    assert problem(undo(api, o, slide, 1, first["version"] + 1)) == (409, "annotation-changed")
    undone = undo(api, o, slide, 1, first["version"])
    assert undone.status_code == 204, undone.text
    assert layer_sources(api, o, slide) == {}
    assert progress(api, o, slide)["checked"] == 0
    assert problem(undo(api, o, slide, 1, first["version"] + 1)) == (409, "not-confirmed")
    again = confirm(api, o, slide, 1)
    assert again.status_code == 201, again.text
    assert (again.json()["id"], again.json()["version"]) == (first["id"], first["version"] + 2)
    history = api(o.people["first"]).get(f"{slide}/shared-layer/objects/{first['id']}/history")
    assert [item["change"] for item in history.json()] == ["created", "deleted", "restored"]
    assert progress(api, o, slide)["confirmed"] == 1


def test_editing_or_deleting_also_checks_and_the_counts_follow(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    layer = f"{slide}/shared-layer"
    as_first = api(o.people["first"])
    assert as_first.put(f"{layer}/ai/T2", json={"deleted": True}).status_code == 201
    assert as_first.put(f"{layer}/ai/T3", json={"geometry": SQUARE}).status_code == 201
    one = confirm(api, o, slide, 1).json()
    four = confirm(api, o, slide, 4).json()
    assert progress(api, o, slide) == {
        "scope": 4,
        "checked": 4,
        "unchecked": 0,
        "confirmed": 2,
        "edited": 1,
        "deleted": 1,
    }
    reshaped = as_first.patch(
        f"{layer}/objects/{one['id']}", json={"version": one["version"], "geometry": SQUARE}
    )
    assert reshaped.status_code == 200, reshaped.text
    assert reshaped.json()["origin"] == "ai-edited"
    gone = as_first.delete(f"{layer}/objects/{four['id']}", params={"version": four["version"]})
    assert gone.status_code == 204, gone.text
    assert layer_sources(api, o, slide)["T4"] == ("ai-edited", True)
    assert progress(api, o, slide) == {
        "scope": 4,
        "checked": 4,
        "unchecked": 0,
        "confirmed": 0,
        "edited": 2,
        "deleted": 2,
    }


def test_an_undone_confirm_can_still_be_fixed(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    first = confirm(api, o, slide, 2).json()
    assert undo(api, o, slide, 2, first["version"]).status_code == 204
    fixed = api(o.people["first"]).put(f"{slide}/shared-layer/ai/T2", json={"geometry": SQUARE})
    assert fixed.status_code == 201, fixed.text
    assert (fixed.json()["id"], fixed.json()["origin"]) == (first["id"], "ai-edited")
    assert progress(api, o, slide)["edited"] == 1


def test_sign_off_counts_an_undone_confirm_as_unchecked(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    versions = {number: confirm(api, o, slide, number).json()["version"] for number in (1, 2, 3, 4)}
    assert api(o.people["first"]).post(f"{slide}/check").status_code == 200
    assert undo(api, o, slide, 4, versions[4]).status_code == 204
    refused = api(o.people["owner"]).post(f"{slide}/sign-off")
    assert problem(refused) == (409, "objects-unchecked")
    assert confirm(api, o, slide, 4).status_code == 201
    signed = api(o.people["owner"]).post(f"{slide}/sign-off")
    assert signed.status_code == 200, signed.text


def test_a_slide_without_a_check_scope_has_no_progress(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database, preset="annotate-by-hand")
    response = api(o.people["first"]).get(f"{slide}/check-status")
    assert response.json()["check_progress"] is None
    confirmed = confirm(api, o, slide, 1)
    assert confirmed.status_code == 201, confirmed.text


def test_a_region_confirm_ignores_a_geometry_from_the_client(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    response = api(o.people["first"]).post(
        f"{slide}/shared-layer/ai/T1/confirm", json={"geometry": SQUARE}
    )
    assert response.status_code == 201, response.text
    assert response.json()["geometry"]["coordinates"] != SQUARE["coordinates"]
