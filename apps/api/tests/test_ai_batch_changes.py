from typing import Any

import pytest
from db_support import ApiAs
from test_ai_confirm import SQUARE, checking, confirm, layer_sources, problem, progress
from test_annotations import make_class
from test_review_order import Ordered

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

WIDE = {"type": "Polygon", "coordinates": [[[0, 0], [30, 0], [30, 9], [0, 9], [0, 0]]]}


def originals(api: ApiAs, o: Ordered, slide: str) -> list[dict[str, Any]]:
    response = api(o.people["first"]).get(f"{slide}/shared-layer/ai")
    assert response.status_code == 200, response.text
    return [
        {key: value for key, value in item.items() if key != "check"}
        for item in response.json()["objects"]
    ]


def change(api: ApiAs, o: Ordered, slide: str, changes: list[dict[str, Any]]) -> Any:
    return api(o.people["first"]).post(
        f"{slide}/shared-layer/ai-changes", json={"changes": changes}
    )


def copies(api: ApiAs, o: Ordered, slide: str) -> dict[str, dict[str, Any]]:
    response = api(o.people["first"]).get(f"{slide}/shared-layer")
    assert response.status_code == 200, response.text
    return {
        item["source"]: item for item in response.json()["objects"] if item["source"] is not None
    }


def test_a_batch_retypes_reshapes_and_deletes_and_the_result_set_stays_as_imported(
    api: ApiAs, database: str
) -> None:
    o, slide = checking(api, database)
    before = originals(api, o, slide)
    other = str(make_class(database, o.tenant, o.project))
    saved = change(
        api,
        o,
        slide,
        [
            {"object": "T1", "class_id": other},
            {"object": "T2", "class_id": other},
            {"object": "T3", "geometry": WIDE},
            {"object": "T4", "deleted": True},
        ],
    )
    assert saved.status_code == 200, saved.text
    made = {item["source"]: item for item in saved.json()["objects"]}
    assert {item["origin"] for item in made.values()} == {"ai-edited"}
    assert (made["T1"]["class_id"], made["T2"]["class_id"]) == (other, other)
    assert made["T3"]["geometry"] == WIDE
    assert made["T4"]["deleted_at"] is not None
    assert originals(api, o, slide) == before
    assert progress(api, o, slide) == {
        "scope": 4,
        "checked": 4,
        "unchecked": 0,
        "confirmed": 0,
        "edited": 3,
        "deleted": 1,
    }


def test_a_stale_version_refuses_the_whole_batch(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    first = change(api, o, slide, [{"object": "T1", "geometry": SQUARE}]).json()["objects"][0]
    stale = change(
        api,
        o,
        slide,
        [
            {"object": "T2", "deleted": True},
            {"object": "T1", "geometry": WIDE, "version": first["version"] + 1},
        ],
    )
    assert problem(stale) == (409, "annotation-changed")
    assert set(layer_sources(api, o, slide)) == {"T1"}
    assert copies(api, o, slide)["T1"]["geometry"] == SQUARE
    assert problem(change(api, o, slide, [{"object": "T1", "deleted": True}])) == (
        409,
        "annotation-changed",
    )


def test_a_copy_is_changed_again_restored_after_a_delete_and_given_the_ai_values_back(
    api: ApiAs, database: str
) -> None:
    o, slide = checking(api, database)
    original = next(item for item in originals(api, o, slide) if item["object"] == "T1")
    gone = change(api, o, slide, [{"object": "T1", "deleted": True}]).json()["objects"][0]
    assert layer_sources(api, o, slide)["T1"] == ("ai-edited", True)
    back = change(
        api,
        o,
        slide,
        [
            {
                "object": "T1",
                "version": gone["version"],
                "geometry": original["geometry"],
                "class_id": original["class_id"],
            }
        ],
    )
    assert back.status_code == 200, back.text
    restored = back.json()["objects"][0]
    assert (restored["id"], restored["deleted_at"]) == (gone["id"], None)
    assert restored["class_id"] == original["class_id"]
    assert layer_sources(api, o, slide)["T1"] == ("ai-edited", False)
    confirmed = confirm(api, o, slide, 2).json()
    retyped = change(
        api,
        o,
        slide,
        [{"object": "T2", "version": confirmed["version"], "class_id": original["class_id"]}],
    )
    assert retyped.status_code == 200, retyped.text
    assert retyped.json()["objects"][0]["origin"] == "ai-edited"


def test_a_batch_is_capped_and_takes_each_object_once(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    twice = change(api, o, slide, [{"object": "T1", "deleted": True}] * 2)
    assert twice.status_code == 422, twice.text
    assert change(api, o, slide, []).status_code == 422
    assert set(layer_sources(api, o, slide)) == set()
