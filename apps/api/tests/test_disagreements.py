import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

VERDICTS = {
    "first": {
        "T1": {"value": "agree"},
        "T2": {"value": "disagree", "reason": "not_class"},
        "C1": {"value": "agree"},
    },
    "second": {
        "T1": {"value": "disagree", "reason": "boundary_off"},
        "T2": {"value": "disagree", "reason": "artefact"},
        "C1": {"value": "agree"},
    },
}


def test_both_kinds_are_queued_once_everyone_has_submitted(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for who, given in VERDICTS.items():
        for object_id, body in given.items():
            saved = api(r.people[who]).put(f"{r.base}/verdicts/{object_id}", json=body)
            assert saved.status_code == 200, saved.text
    task = f"/api/review-tasks/{r.task}"
    assert api(r.people["owner"]).get(f"{task}/disagreements").json() == []
    for who in VERDICTS:
        assert api(r.people[who]).post(f"{r.base}/submit").status_code == 200
    queue = api(r.people["owner"]).get(f"{task}/disagreements").json()
    assert [(item["object"], item["why"]) for item in queue] == [
        ("T1", "reviewers-differ"),
        ("T2", "against-the-ai"),
    ]
    assert sorted(v["value"] for v in queue[0]["verdicts"]) == ["agree", "disagree"]
    slides = api(r.people["owner"]).get(f"{task}/states").json()["slides"]
    assert slides[0]["state"] == "disagreement-queue"
    refused = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (refused.status_code, refused.json()["code"]) == (409, "disagreements-open")
    assert api(r.people["viewer"]).get(f"{task}/disagreements").status_code == 200
    hidden = api(r.people["first"]).get(f"{task}/disagreements")
    assert (hidden.status_code, hidden.json()["code"]) == (403, "disagreements-hidden")
    assert api(r.people["second"]).post(f"{r.base}/reopen").status_code == 200
    assert api(r.people["owner"]).get(f"{task}/disagreements").json() == []


def test_agreeing_reviewers_leave_nothing_to_decide(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for who in ("first", "second"):
        api(r.people[who]).put(f"{r.base}/verdicts/T1", json={"value": "agree"})
        api(r.people[who]).post(f"{r.base}/submit")
    task = f"/api/review-tasks/{r.task}"
    assert api(r.people["owner"]).get(f"{task}/disagreements").json() == []
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200


def queued_review(api: ApiAs, database: str) -> tuple[Review, str]:
    r = review(api, database)
    for who, given in VERDICTS.items():
        for object_id, body in given.items():
            api(r.people[who]).put(f"{r.base}/verdicts/{object_id}", json=body)
        api(r.people[who]).post(f"{r.base}/submit")
    return r, f"/api/review-tasks/{r.task}"


def test_decisions_close_the_queue_and_lock_at_sign_off(api: ApiAs, database: str) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    kept = api(r.people["owner"]).put(f"{decide}/T1", json={"decision": "keep-ai", "note": "Edge"})
    assert kept.status_code == 200, kept.text
    assert (kept.json()["decision"], kept.json()["note"]) == ("keep-ai", "Edge")
    still = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (still.status_code, still.json()["code"]) == (409, "disagreements-open")
    changed = api(r.people["owner"]).put(f"{decide}/T1", json={"decision": "go-with-reviewers"})
    assert changed.json()["decision"] == "go-with-reviewers"
    assert (
        api(r.people["owner"]).put(f"{decide}/T2", json={"decision": "keep-ai"}).status_code == 200
    )
    slides = api(r.people["owner"]).get(f"{task}/states").json()["slides"]
    assert slides[0]["state"] == "submitted"
    assert api(r.people["owner"]).delete(f"{decide}/T2").status_code == 204
    assert api(r.people["owner"]).get(f"{task}/states").json()["slides"][0]["state"] == (
        "disagreement-queue"
    )
    api(r.people["owner"]).put(f"{decide}/T2", json={"decision": "keep-ai"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    late = api(r.people["owner"]).put(f"{decide}/T2", json={"decision": "go-with-reviewers"})
    assert (late.status_code, late.json()["code"]) == (409, "task-signed-off")
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
    )
    decisions = [row[0] for row in actions if str(row[0]).startswith("review.decision")]
    assert decisions == [
        "review.decision-set",
        "review.decision-set",
        "review.decision-set",
        "review.decision-cleared",
        "review.decision-set",
    ]


def test_only_owners_decide_and_only_queued_objects(api: ApiAs, database: str) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    viewer = api(r.people["viewer"]).put(f"{decide}/T1", json={"decision": "keep-ai"})
    assert (viewer.status_code, viewer.json()["code"]) == (403, "project-owners-only")
    assert (
        api(r.people["first"]).put(f"{decide}/T1", json={"decision": "keep-ai"}).status_code == 403
    )
    agreed = api(r.people["owner"]).put(f"{decide}/C1", json={"decision": "keep-ai"})
    assert (agreed.status_code, agreed.json()["code"]) == (404, "not-queued")
    assert api(r.people["owner"]).put(f"{decide}/T1", json={"decision": "maybe"}).status_code == 422
