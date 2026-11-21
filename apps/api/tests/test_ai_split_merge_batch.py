from typing import Any

import pytest
from db_support import ApiAs
from test_ai_batch_changes import copies, originals
from test_ai_confirm import checking
from test_review_order import Ordered

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

LEFT = {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 9], [0, 9], [0, 0]]]}
RIGHT = {"type": "Polygon", "coordinates": [[[6, 0], [9, 0], [9, 9], [6, 9], [6, 0]]]}
BOTH = {"type": "Polygon", "coordinates": [[[0, 0], [30, 0], [30, 9], [0, 9], [0, 0]]]}


def batch(api: ApiAs, o: Ordered, slide: str, body: dict[str, Any]) -> Any:
    return api(o.people["first"]).post(f"{slide}/shared-layer/ai-changes", json=body)


def live(api: ApiAs, o: Ordered, slide: str) -> list[dict[str, Any]]:
    response = api(o.people["first"]).get(f"{slide}/shared-layer")
    assert response.status_code == 200, response.text
    return [item for item in response.json()["objects"] if item["deleted_at"] is None]


def split_first(api: ApiAs, o: Ordered, slide: str) -> tuple[dict[str, Any], dict[str, Any]]:
    split = batch(
        api,
        o,
        slide,
        {
            "changes": [{"object": "T1", "geometry": LEFT}],
            "added": [{"kind": "region", "geometry": RIGHT}],
        },
    )
    assert split.status_code == 200, split.text
    (kept,) = split.json()["objects"]
    (part,) = split.json()["added"]
    return kept, part


def test_a_split_keeps_the_source_on_one_part_and_adds_the_rest_in_one_batch(
    api: ApiAs, database: str
) -> None:
    o, slide = checking(api, database)
    before = originals(api, o, slide)
    kept, part = split_first(api, o, slide)
    assert (kept["source"], kept["geometry"]) == ("T1", LEFT)
    assert (part["origin"], part["source"], part["geometry"]) == ("human", None, RIGHT)
    assert originals(api, o, slide) == before
    undone = batch(
        api,
        o,
        slide,
        {
            "changes": [{"object": "T1", "geometry": BOTH, "version": kept["version"]}],
            "removed": [{"id": part["id"], "version": part["version"]}],
        },
    )
    assert undone.status_code == 200, undone.text
    assert copies(api, o, slide)["T1"]["geometry"] == BOTH
    assert part["id"] not in {item["id"] for item in live(api, o, slide)}


def test_a_stale_part_refuses_the_whole_batch(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    kept, part = split_first(api, o, slide)
    refused = batch(
        api,
        o,
        slide,
        {
            "changes": [{"object": "T1", "geometry": BOTH, "version": kept["version"]}],
            "removed": [{"id": part["id"], "version": part["version"] + 1}],
        },
    )
    assert refused.status_code == 409, refused.text
    assert copies(api, o, slide)["T1"]["geometry"] == LEFT
    assert part["id"] in {item["id"] for item in live(api, o, slide)}


def test_a_merge_keeps_every_source_number(api: ApiAs, database: str) -> None:
    o, slide = checking(api, database)
    merged = batch(
        api,
        o,
        slide,
        {"changes": [{"object": "T1", "geometry": BOTH}, {"object": "T2", "deleted": True}]},
    )
    assert merged.status_code == 200, merged.text
    kept = copies(api, o, slide)
    assert kept["T1"]["geometry"] == BOTH
    assert kept["T2"]["deleted_at"] is not None
