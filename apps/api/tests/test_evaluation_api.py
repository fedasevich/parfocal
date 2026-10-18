from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review

pytestmark = pytest.mark.db

SMALL_SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]]}
FAR_REGION = {
    "type": "Polygon",
    "coordinates": [[[300, 0], [400, 0], [400, 50], [300, 50], [300, 0]]],
}


def put(api: ApiAs, r: Review, who: str, path: str, body: dict[str, Any]) -> None:
    response = api(r.people[who]).put(f"{r.base}/{path}", json=body)
    assert response.status_code == 200, response.text


def scenario(api: ApiAs, database: str) -> Review:
    r = review(api, database)
    tumor = str(r.tumor)
    wrong = {"value": "disagree", "reason": "wrong_class", "reason_class_id": tumor}
    for object_id, body in {
        "T1": {"value": "agree"},
        "T2": {"value": "disagree", "reason": "boundary_off"},
        "C1": {"value": "agree"},
        "C2": wrong,
    }.items():
        put(api, r, "first", f"verdicts/{object_id}", body)
    for object_id, body in {
        "T1": {"value": "agree"},
        "T2": {"value": "disagree", "reason": "not_class"},
        "C1": {"value": "disagree", "reason": "not_a_cell"},
        "C2": wrong,
    }.items():
        put(api, r, "second", f"verdicts/{object_id}", body)
    put(api, r, "first", "edits/T1", {"geometry": SMALL_SQUARE})
    added = api(r.people["first"]).post(
        f"{r.base}/added", json={"kind": "region", "geometry": FAR_REGION, "class_id": tumor}
    )
    assert added.status_code == 201, added.text
    put(api, r, "first", "opinion", {"answers": {"acceptable": 4, "main_error": "Boundaries"}})
    put(api, r, "second", "opinion", {"answers": {"acceptable": 2}})
    for who in ("first", "second"):
        assert api(r.people[who]).post(f"{r.base}/submit").status_code == 200
    decided = api(r.people["owner"]).put(
        f"/api/review-tasks/{r.task}/disagreements/{r.slide}/C1",
        json={"decision": "go-with-reviewers"},
    )
    assert decided.status_code == 200, decided.text
    return r


def test_the_evaluation_matches_the_hand_computed_task(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    response = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/evaluation")
    assert response.status_code == 200, response.text
    body = response.json()
    by_class = {(item["kind"], item["class_name"]): item for item in body["classes"]}
    regions = by_class[("region", "unclassified")]
    assert (regions["true_positives"], regions["false_positives"], regions["false_negatives"]) == (
        1,
        1,
        0,
    )
    assert regions["precision"] == {"value": 0.5, "numerator": 1, "denominator": 2}
    assert by_class[("region", "Tumor")]["sensitivity"] == {
        "value": 0.0,
        "numerator": 0,
        "denominator": 1,
    }
    cells = by_class[("cell", "unclassified")]
    assert (cells["false_positives"], cells["precision"]["value"]) == (2, 0.0)
    assert by_class[("cell", "Tumor")]["false_negatives"] == 1
    assert body["dice"]["unclassified"]["value"] == pytest.approx(0.4)
    assert body["dice"]["Tumor"]["value"] == 0.0
    ((pair),) = body["kappa"]
    assert (pair["value"], pair["objects"]) == (pytest.approx(0.5), 4)
    assert body["mean_kappa"] == pytest.approx(0.5)
    assert body["fleiss_kappa"] is None
    assert body["cell_agreement_with_ai"] == {"value": 0.0, "numerator": 0, "denominator": 2}
    assert body["cell_agreement_between_reviewers"]["numerator"] == 1
    assert body["reasons"] == [
        ["wrong_class", 2],
        ["boundary_off", 1],
        ["not_a_cell", 1],
        ["not_class", 1],
    ]
    opinions = {item["key"]: item for item in body["opinions"]}
    assert (opinions["acceptable"]["mean"], opinions["acceptable"]["count"]) == (3.0, 2)
    assert opinions["main_error"]["counts"] == {"Boundaries": 1}


def test_reviewers_and_other_workspaces_do_not_see_the_evaluation(
    api: ApiAs, database: str
) -> None:
    r = scenario(api, database)
    path = f"/api/review-tasks/{r.task}/evaluation"
    hidden = api(r.people["first"]).get(path)
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")
    assert api(r.people["viewer"]).get(path).status_code == 200
    other = review(api, database)
    assert api(other.people["owner"]).get(path).status_code == 404
