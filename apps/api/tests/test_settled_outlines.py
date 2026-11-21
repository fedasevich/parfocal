from typing import Any

import pytest
import shapely
from db_support import ApiAs
from submit_support import submitted
from test_outline_disagreements import REGION, redrawn, square
from test_reviewed_layer import Review, edit, review
from workspace_support import owner

pytestmark = pytest.mark.db

FAR = square(50, 0, 100)
DRAWN = square(20, 20, 50)
CELL = square(95, 95, 10)
CELL_FAR = square(101, 95, 10)


def ring_of(shape: dict[str, Any]) -> list[float]:
    return [value for point in shape["coordinates"][0][:-1] for value in point]


def same_shape(found: dict[str, Any] | list[float], expected: dict[str, Any]) -> bool:
    if isinstance(found, list):
        points = [(found[index], found[index + 1]) for index in range(0, len(found), 2)]
        found = {"type": "Polygon", "coordinates": [[*points, points[0]]]}
    return shapely.geometry.shape(found).equals(shapely.geometry.shape(expected))


def queue_row(api: ApiAs, r: Review, object_id: str) -> dict[str, Any]:
    rows = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreement-queue")
    assert rows.status_code == 200, rows.text
    [row] = [row for row in rows.json()["rows"] if row["object"] == object_id]
    return row


def outline_url(r: Review, object_id: str) -> str:
    return f"/api/review-tasks/{r.task}/disagreement-queue/{r.slide}/{object_id}/outline"


def stored(database: str, r: Review) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT number, value, outline_from_user_id, outline_by_user_id, outline_at IS NOT NULL "
        f"FROM disagreement_decisions WHERE task_id = '{r.task}' ORDER BY number",
    )


def test_the_owner_picks_a_reviewers_outline_and_undoes_it(api: ApiAs, database: str) -> None:
    r = redrawn(api, database, "T1", REGION, FAR)
    as_owner = api(r.people["owner"])
    second = r.people["second"].user_id
    picked = as_owner.put(outline_url(r, "T1"), json={"from_user_id": str(second)})
    assert picked.status_code == 200, picked.text
    settled = picked.json()["settled_outline"]
    assert same_shape(settled["outline"], FAR)
    assert settled["from_user_id"] == str(second)
    assert settled["by_user_id"] == str(r.people["owner"].user_id)
    assert settled["at"]
    assert stored(database, r) == [(1, None, second, r.people["owner"].user_id, True)]
    assert queue_row(api, r, "T1")["state"] == "open"
    undone = as_owner.delete(outline_url(r, "T1"))
    assert undone.status_code == 200, undone.text
    assert undone.json()["settled_outline"] is None
    assert stored(database, r) == []
    actions = owner(
        database,
        "SELECT action FROM audit_events WHERE action LIKE 'review.outline-%' AND tenant_id = "
        f"(SELECT tenant_id FROM review_tasks WHERE id = '{r.task}') ORDER BY occurred_at",
    )
    assert actions == [("review.outline-settled",), ("review.outline-cleared",)]


def test_the_owner_draws_a_new_outline_that_outlives_a_cleared_decision(
    api: ApiAs, database: str
) -> None:
    r = redrawn(api, database, "T1", REGION, FAR)
    as_owner = api(r.people["owner"])
    stranger = as_owner.put(
        outline_url(r, "T1"), json={"from_user_id": str(r.people["third"].user_id)}
    )
    assert (stranger.status_code, stranger.json()["code"]) == (400, "not-a-reviewer-outline")
    point = as_owner.put(
        outline_url(r, "T1"), json={"geometry": {"type": "Point", "coordinates": [1, 1]}}
    )
    assert point.status_code in (400, 422), point.text
    both = as_owner.put(
        outline_url(r, "T1"),
        json={"from_user_id": str(r.people["first"].user_id), "geometry": DRAWN},
    )
    assert both.status_code == 422
    drawn = as_owner.put(outline_url(r, "T1"), json={"geometry": DRAWN})
    assert drawn.status_code == 200, drawn.text
    assert drawn.json()["settled_outline"]["from_user_id"] is None
    assert same_shape(drawn.json()["settled_outline"]["outline"], DRAWN)
    task = f"/api/review-tasks/{r.task}/disagreements/{r.slide}/T1"
    assert as_owner.put(task, json={"answer": "agree"}).status_code == 200
    assert queue_row(api, r, "T1")["state"] == "decided"
    assert as_owner.delete(task).status_code == 204
    row = queue_row(api, r, "T1")
    assert (row["state"], same_shape(row["settled_outline"]["outline"], DRAWN)) == ("open", True)
    assert as_owner.put(task, json={"answer": "agree"}).status_code == 200
    assert as_owner.post(f"/api/review-tasks/{r.task}/sign-off").status_code == 200
    late = as_owner.put(outline_url(r, "T1"), json={"geometry": REGION})
    assert (late.status_code, late.json()["code"]) == (409, "task-signed-off")
    reviewer = api(r.people["first"]).put(outline_url(r, "T1"), json={"geometry": REGION})
    assert reviewer.status_code == 403


def adjudication_url(r: Review, object_id: str) -> str:
    return f"/api/review-tasks/{r.task}/adjudication/{r.slide}/{object_id}/outline"


def test_the_adjudicator_picks_by_letter_and_draws_without_seeing_who(
    api: ApiAs, database: str
) -> None:
    r = redrawn(api, database, "T1", REGION, FAR)
    sent = api(r.people["owner"]).post(
        f"/api/review-tasks/{r.task}/disagreements/adjudications",
        json={
            "adjudicator_user_id": str(r.people["third"].user_id),
            "objects": [{"slide_id": str(r.slide), "object": "T1"}],
        },
    )
    assert sent.status_code in (200, 201), sent.text
    blocked = api(r.people["owner"]).put(outline_url(r, "T1"), json={"geometry": DRAWN})
    assert (blocked.status_code, blocked.json()["code"]) == (409, "with-adjudicator")
    judge = api(r.people["third"])
    mine = judge.get(f"/api/review-tasks/{r.task}/adjudication")
    assert mine.status_code == 200, mine.text
    [shown] = mine.json()["objects"]
    assert [entry["reviewer"] for entry in shown["outlines"]] == ["A", "B"]
    assert str(r.people["first"].user_id) not in mine.text
    letter = next(
        entry["reviewer"] for entry in shown["outlines"] if same_shape(entry["outline"], FAR)
    )
    picked = judge.put(adjudication_url(r, "T1"), json={"reviewer": letter})
    assert picked.status_code == 200, picked.text
    assert picked.json()["settled_outline"]["from_reviewer"] == letter
    assert same_shape(picked.json()["settled_outline"]["outline"], FAR)
    assert str(r.people["second"].user_id) not in picked.text
    row = queue_row(api, r, "T1")
    assert row["settled_outline"]["from_user_id"] == str(r.people["second"].user_id)
    assert row["settled_outline"]["by_user_id"] == str(r.people["third"].user_id)
    judge = api(r.people["third"])
    cleared = judge.delete(adjudication_url(r, "T1"))
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["settled_outline"] is None
    drawn = judge.put(adjudication_url(r, "T1"), json={"geometry": DRAWN})
    assert drawn.status_code == 200, drawn.text
    assert drawn.json()["settled_outline"]["from_reviewer"] is None
    other = api(r.people["first"]).put(adjudication_url(r, "T1"), json={"geometry": DRAWN})
    assert other.status_code == 404


def test_the_consensus_export_uses_the_settled_outline_and_covers_cells(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    shapes = {"first": (REGION, CELL), "second": (FAR, CELL_FAR)}
    for who, (region, cell) in shapes.items():
        assert edit(api, r, who, "T1", {"geometry": region}).status_code == 200
        assert edit(api, r, who, "C1", {"geometry": cell}).status_code == 200
        for object_id in ("T1", "C1", "C2"):
            given = api(r.people[who]).put(
                f"{r.base}/decisions/{object_id}", json={"value": "agree"}
            )
            assert given.status_code == 200, given.text
        assert submitted(api(r.people[who]), r.base).status_code == 200
    as_owner = api(r.people["owner"])
    assert as_owner.put(outline_url(r, "T1"), json={"geometry": DRAWN}).status_code == 200
    second = str(r.people["second"].user_id)
    assert as_owner.put(outline_url(r, "C1"), json={"from_user_id": second}).status_code == 200
    response = as_owner.get(f"{r.base}/export", params={"consensus": "true"})
    assert response.status_code == 200, response.text
    features = {feature["id"]: feature for feature in response.json()["features"]}
    assert {"T1", "C1", "C2"} <= set(features)
    assert same_shape(features["T1"]["geometry"], DRAWN)
    assert features["T1"]["properties"]["parfocal"]["changed"] == ["reshaped", "settled"]
    assert same_shape(features["C1"]["geometry"], CELL_FAR)
    assert features["C1"]["properties"]["objectType"] == "cell"
    assert features["C1"]["properties"]["parfocal"]["changed"] == ["reshaped", "settled"]
    assert features["C2"]["properties"]["parfocal"]["changed"] == []
    assert features["C2"]["geometry"]["type"] == "Polygon"
    assert ring_of(features["C2"]["geometry"])
    task = api(r.people["owner"]).get(
        f"/api/review-tasks/{r.task}/evaluation/exports/annotations.geojson"
    )
    assert task.status_code == 200, task.text
    exported = {feature["id"]: feature for feature in task.json()["features"]}
    assert same_shape(exported["C1"]["geometry"], CELL_FAR)


def test_the_adjudicator_gets_letters_for_redraws_without_answers(
    api: ApiAs, database: str
) -> None:
    r = redrawn(api, database, "C1", CELL, CELL_FAR)
    sent = api(r.people["owner"]).post(
        f"/api/review-tasks/{r.task}/disagreements/adjudications",
        json={
            "adjudicator_user_id": str(r.people["third"].user_id),
            "objects": [{"slide_id": str(r.slide), "object": "C1"}],
        },
    )
    assert sent.status_code in (200, 201), sent.text
    mine = api(r.people["third"]).get(f"/api/review-tasks/{r.task}/adjudication")
    [shown] = mine.json()["objects"]
    assert [entry["reviewer"] for entry in shown["outlines"]] == ["A", "B"]
    picked = api(r.people["third"]).put(adjudication_url(r, "C1"), json={"reviewer": "A"})
    assert picked.status_code == 200, picked.text
    broken = api(r.people["third"]).put(
        adjudication_url(r, "C1"),
        json={"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]}},
    )
    assert broken.status_code in (400, 422), broken.text
