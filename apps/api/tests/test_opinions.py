from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db


def save(api: ApiAs, r: Review, who: str, answers: dict[str, Any]) -> Any:
    return api(r.people[who]).put(f"{r.base}/opinion", json={"answers": answers})


def test_answers_merge_as_a_draft_and_lock_on_submit(api: ApiAs, database: str) -> None:
    r = review(api, database)
    first = save(api, r, "first", {"acceptable": 4, "main_error": "Boundaries"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert (body["form_version"], body["draft"], body["answers"]) == (
        1,
        True,
        {"acceptable": 4, "main_error": "Boundaries"},
    )
    assert [q["key"] for q in body["questions"]] == [
        "acceptable",
        "main_error",
        "sign_as_is",
        "comment",
    ]
    merged = save(api, r, "first", {"sign_as_is": True, "acceptable": None}).json()
    assert merged["answers"] == {"main_error": "Boundaries", "sign_as_is": True}
    assert api(r.people["first"]).post(f"{r.base}/submit").status_code == 200
    assert api(r.people["first"]).get(f"{r.base}/opinion").json()["draft"] is False
    locked = save(api, r, "first", {"acceptable": 3})
    assert (locked.status_code, locked.json()["code"]) == (409, "already-submitted")
    assert api(r.people["first"]).post(f"{r.base}/reopen").status_code == 200
    assert save(api, r, "first", {"acceptable": 3}).json()["draft"] is True


@pytest.mark.parametrize(
    "answers",
    [
        {"acceptable": 7},
        {"acceptable": "4"},
        {"acceptable": True},
        {"main_error": "Nope"},
        {"sign_as_is": "yes"},
        {"comment": "x" * 2001},
        {"unknown": 1},
    ],
)
def test_answers_must_fit_their_question(
    api: ApiAs, database: str, answers: dict[str, Any]
) -> None:
    r = review(api, database)
    response = save(api, r, "first", answers)
    assert (response.status_code, response.json()["code"]) == (400, "invalid-answer")


def test_the_task_keeps_its_form_version(api: ApiAs, database: str) -> None:
    r = review(api, database)
    changed = api(r.people["owner"]).put(
        f"/api/projects/{r.project}/opinion-form",
        json={"questions": [{"kind": "yesno", "key": "fine", "label": "Fine?"}]},
    )
    assert changed.status_code == 200, changed.text
    body = save(api, r, "first", {"acceptable": 5}).json()
    assert body["form_version"] == 1
    assert save(api, r, "first", {"fine": True}).json()["code"] == "invalid-answer"


def test_only_the_reviewer_writes_and_owners_read_every_opinion(api: ApiAs, database: str) -> None:
    r = review(api, database)
    save(api, r, "first", {"comment": "Edges look loose near the capsule"})
    first_id = str(r.people["first"].user_id)
    peek = api(r.people["second"]).get(f"{r.base}/opinion", params={"reviewer_id": first_id})
    assert (peek.status_code, peek.json()["code"]) == (403, "other-reviewer")
    as_owner = api(r.people["owner"]).get(f"{r.base}/opinion", params={"reviewer_id": first_id})
    assert as_owner.json()["answers"] == {"comment": "Edges look loose near the capsule"}
    assert save(api, r, "viewer", {"acceptable": 1}).json()["code"] == "not-assigned"
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{r.task}' AND action = 'review.opinion-saved'",
    )
    assert "capsule" not in str(details)
    assert "comment" in str(details)


def test_an_opinion_puts_the_reviewer_in_review(api: ApiAs, database: str) -> None:
    r = review(api, database)
    save(api, r, "second", {"acceptable": 2})
    slides = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/states").json()["slides"]
    by_user = {item["user_id"]: item["state"] for item in slides[0]["reviewers"]}
    assert by_user[str(r.people["second"].user_id)] == "in-review"
