import pytest
from db_support import ApiAs
from test_reviewed_layer import review

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
