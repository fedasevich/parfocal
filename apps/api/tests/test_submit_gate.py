from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import SQUARE, Review, review

pytestmark = pytest.mark.db

ANSWERED = {"acceptable": 4}


def decide(api: ApiAs, r: Review, object_id: str, value: str = "agree") -> None:
    body: dict[str, Any] = {"value": value}
    if value == "unsure":
        body["reasons"] = ["need_ihc"]
    response = api(r.people["first"]).put(f"{r.base}/decisions/{object_id}", json=body)
    assert response.status_code == 200, response.text


def answer(api: ApiAs, r: Review, answers: dict[str, Any]) -> None:
    response = api(r.people["first"]).put(f"{r.base}/opinion", json={"answers": answers})
    assert response.status_code == 200, response.text


def submit(api: ApiAs, r: Review) -> Any:
    return api(r.people["first"]).post(f"{r.base}/submit")


def test_an_open_object_refuses_the_submit_and_names_it(api: ApiAs, database: str) -> None:
    r = review(api, database)
    answer(api, r, ANSWERED)
    decide(api, r, "T1")
    refused = submit(api, r)
    body = refused.json()
    assert (refused.status_code, body["code"]) == (409, "review-not-done"), refused.text
    assert body["current"] == {"open_objects": ["T2"], "unanswered_questions": []}
    assert body["detail"] == "Still open: T2."


def test_an_unanswered_required_question_refuses_the_submit(api: ApiAs, database: str) -> None:
    r = review(api, database)
    decide(api, r, "T1")
    decide(api, r, "T2")
    answer(api, r, {"main_error": "Boundaries"})
    refused = submit(api, r)
    body = refused.json()
    assert (refused.status_code, body["code"]) == (409, "review-not-done"), refused.text
    assert body["current"] == {"open_objects": [], "unanswered_questions": ["acceptable"]}


def test_the_last_open_object_answered_not_sure_lets_the_submit_through(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    answer(api, r, ANSWERED)
    decide(api, r, "T1")
    assert submit(api, r).status_code == 409
    decide(api, r, "T2", "unsure")
    accepted = submit(api, r)
    assert accepted.status_code == 200, accepted.text


def test_an_object_the_reviewer_added_never_blocks_the_submit(api: ApiAs, database: str) -> None:
    r = review(api, database)
    added = api(r.people["first"]).post(
        f"{r.base}/added", json={"kind": "region", "geometry": SQUARE}
    )
    assert added.status_code == 201, added.text
    answer(api, r, ANSWERED)
    decide(api, r, "T1")
    decide(api, r, "T2")
    accepted = submit(api, r)
    assert accepted.status_code == 200, accepted.text


def test_another_reviewers_decisions_do_not_count(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for object_id in ("T1", "T2"):
        other = api(r.people["second"]).put(
            f"{r.base}/decisions/{object_id}", json={"value": "agree"}
        )
        assert other.status_code == 200, other.text
    answer(api, r, ANSWERED)
    refused = submit(api, r)
    assert refused.json()["current"]["open_objects"] == ["T1", "T2"], refused.text
