from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_ai_confirm import problem, progress
from test_check_options import made
from test_review_order import Ordered, ordered

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def added(api: ApiAs, database: str) -> tuple[Ordered, str]:
    o = ordered(database, api)
    task = made(api, o, slide=0, pinned=False, preset="check-whole-slide-run")
    slide = f"/api/review-tasks/{task}/slides/{o.slides[0]}"
    joined = api(o.people["first"]).post(f"{slide}/runs", json={"result_set_id": str(o.sets[0])})
    assert joined.status_code == 200, joined.text
    run_orders(database, o.tenant)
    return o, slide


def change(api: ApiAs, o: Ordered, slide: str, changes: list[dict[str, Any]]) -> Any:
    return api(o.people["first"]).post(
        f"{slide}/shared-layer/ai-changes", json={"changes": changes}
    )


def test_the_cells_of_an_added_run_are_confirmed_deleted_and_brought_back(
    api: ApiAs, database: str
) -> None:
    o, slide = added(api, database)
    expert = api(o.people["first"])
    listed = expert.get(f"{slide}/shared-layer/ai").json()
    shapes = {item["object"]: item["geometry"] for item in listed["objects"]}
    assert [item["object"] for item in listed["objects"] if item["kind"] == "cell"] == [
        f"C{number}" for number in range(1, 7)
    ]
    confirmed = expert.post(f"{slide}/shared-layer/ai/C5/confirm", json={"geometry": shapes["C5"]})
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["origin"] == "ai-confirmed"
    gone = change(
        api,
        o,
        slide,
        [
            {"object": "C6", "deleted": True, "geometry": shapes["C6"]},
            {"object": "T2", "deleted": True},
        ],
    )
    assert gone.status_code == 200, gone.text
    assert progress(api, o, slide)["confirmed"] == 1
    assert progress(api, o, slide)["deleted"] == 2
    copy = next(item for item in gone.json()["objects"] if item["source"] == "C6")
    back = change(api, o, slide, [{"object": "C6", "version": copy["version"]}])
    assert back.status_code == 200, back.text
    assert back.json()["objects"][0]["deleted_at"] is None
    assert progress(api, o, slide)["deleted"] == 1
    undone = expert.delete(
        f"{slide}/shared-layer/ai/C5/confirm", params={"version": confirmed.json()["version"]}
    )
    assert undone.status_code == 204, undone.text
    assert progress(api, o, slide)["confirmed"] == 0


def test_a_cell_or_region_the_run_lacks_is_refused_and_nothing_is_saved(
    api: ApiAs, database: str
) -> None:
    o, slide = added(api, database)
    expert = api(o.people["first"])
    unknown = expert.post(f"{slide}/shared-layer/ai/C99/confirm", json={})
    assert problem(unknown) == (404, "unknown-object")
    assert unknown.json()["detail"] == "C99 is not in this result set"
    batch = change(
        api, o, slide, [{"object": "C1", "deleted": True}, {"object": "T40", "deleted": True}]
    )
    assert problem(batch) == (404, "unknown-object")
    layer = expert.get(f"{slide}/shared-layer").json()["objects"]
    assert [item for item in layer if item["source"] is not None] == []
