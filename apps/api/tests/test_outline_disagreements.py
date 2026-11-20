from typing import Any

import pytest
from db_support import ApiAs
from submit_support import submitted
from test_reviewed_layer import Review, edit, review

pytestmark = pytest.mark.db


def square(left: float, top: float, side: float) -> dict[str, Any]:
    right, bottom = left + side, top + side
    ring = [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
    return {"type": "Polygon", "coordinates": [ring]}


REGION = square(0, 0, 100)
CELL = square(95, 95, 10)

CASES = {
    "region equal": ("T1", REGION, REGION, None),
    "region close": ("T1", REGION, square(5, 5, 90), None),
    "region far": ("T1", REGION, square(50, 0, 100), 1 / 3),
    "cell equal": ("C1", CELL, CELL, None),
    "cell close": ("C1", CELL, square(96, 95, 10), None),
    "cell far": ("C1", CELL, square(101, 95, 10), 0.25),
}


def redrawn(api: ApiAs, database: str, object_id: str, *shapes: dict[str, Any]) -> Review:
    r = review(api, database)
    for who, shape in zip(("first", "second"), shapes, strict=True):
        saved = edit(api, r, who, object_id, {"geometry": shape})
        assert saved.status_code == 200, saved.text
    for who in ("first", "second"):
        assert submitted(api(r.people[who]), r.base).status_code == 200
    return r


def queue(api: ApiAs, r: Review) -> list[dict[str, Any]]:
    found = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreements")
    assert found.status_code == 200, found.text
    return found.json()


@pytest.mark.parametrize(("object_id", "first", "second", "overlap"), CASES.values(), ids=CASES)
def test_outlines_below_the_task_overlap_reach_the_queue(
    api: ApiAs,
    database: str,
    object_id: str,
    first: dict[str, Any],
    second: dict[str, Any],
    overlap: float | None,
) -> None:
    r = redrawn(api, database, object_id, first, second)
    found = [item for item in queue(api, r) if item["object"] == object_id]
    if overlap is None:
        assert found == []
        return
    [item] = found
    assert item["why"] == "outlines-differ"
    assert item["outline_overlap"] == pytest.approx(overlap)
    assert sorted(entry["user_id"] for entry in item["outlines"]) == sorted(
        str(r.people[who].user_id) for who in ("first", "second")
    )
    assert all(len(entry["outline"]) == 8 for entry in item["outlines"])
    rows = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreement-queue").json()
    [row] = [row for row in rows["rows"] if row["object"] == object_id]
    assert (row["tag"], row["outline_differs"], len(row["outlines"])) == ("outline", True, 2)
    refused = api(r.people["owner"]).post(f"/api/review-tasks/{r.task}/sign-off")
    assert (refused.status_code, refused.json()["code"]) == (409, "disagreements-open")


def home_open(api: ApiAs, r: Review) -> int:
    response = api(r.people["owner"]).get("/api/me/home")
    assert response.status_code == 200, response.text
    return int(response.json()["week"]["open_disagreements"])


def test_the_task_overlap_decides_and_home_counts_outline_gaps(api: ApiAs, database: str) -> None:
    r = redrawn(api, database, "T1", REGION, square(5, 5, 90))
    task = f"/api/review-tasks/{r.task}"
    assert api(r.people["owner"]).get(task).json()["outline_overlap"] == 60
    assert queue(api, r) == []
    assert home_open(api, r) == 0
    stricter = api(r.people["owner"]).patch(task, json={"outline_overlap": 90})
    assert (stricter.status_code, stricter.json()["outline_overlap"]) == (200, 90)
    [item] = queue(api, r)
    assert (item["object"], item["outline_overlap"]) == ("T1", pytest.approx(0.81))
    assert home_open(api, r) == 1
    decided = api(r.people["owner"]).put(
        f"{task}/disagreements/{r.slide}/T1", json={"answer": "agree"}
    )
    assert decided.status_code == 200, decided.text
    assert home_open(api, r) == 0
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    late = api(r.people["owner"]).patch(task, json={"outline_overlap": 50})
    assert (late.status_code, late.json()["code"]) == (409, "outline-overlap-signed-off")
    refused = api(r.people["owner"]).patch(task, json={"outline_overlap": 100})
    assert refused.status_code == 422


def test_differing_decisions_keep_their_reason_and_flag_the_outline(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    for who, value, shape in (
        ("first", "agree", REGION),
        ("second", "disagree", square(50, 0, 100)),
    ):
        assert edit(api, r, who, "T1", {"geometry": shape}).status_code == 200
        body = {"value": value} if value == "agree" else {"value": value, "reasons": ["not_class"]}
        assert api(r.people[who]).put(f"{r.base}/decisions/T1", json=body).status_code == 200
        assert submitted(api(r.people[who]), r.base).status_code == 200
    [item] = [item for item in queue(api, r) if item["object"] == "T1"]
    assert item["why"] == "reviewers-differ"
    assert item["outline_overlap"] == pytest.approx(1 / 3)
    rows = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreement-queue").json()
    [row] = [row for row in rows["rows"] if row["object"] == "T1"]
    assert (row["tag"], row["outline_differs"]) == ("differ", True)


def test_a_released_or_still_working_reviewer_is_not_compared(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for who, shape in (("first", REGION), ("second", square(50, 0, 100))):
        assert edit(api, r, who, "T1", {"geometry": shape}).status_code == 200
    assert submitted(api(r.people["first"]), r.base).status_code == 200
    assert queue(api, r) == []
