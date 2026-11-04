import json
from typing import Any, cast

import pytest
from db_support import ApiAs
from test_decision_styles import answer
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

GIVEN = {
    "first": {
        "T1": {"value": "agree"},
        "T2": {"value": "disagree", "reasons": ["not_class"]},
        "C1": {"value": "agree"},
    },
    "second": {
        "T1": {"value": "disagree", "reasons": ["boundary_off"]},
        "T2": {"value": "disagree", "reasons": ["artefact"]},
        "C1": {"value": "agree"},
    },
}
PERSONAL_KEYS = {"user_id", "decided_by_user_id", "display_name", "initials", "avatar_colour"}


def queued(api: ApiAs, database: str) -> tuple[Review, str]:
    r = review(api, database)
    for who, given in GIVEN.items():
        for object_id, body in given.items():
            noted = body | {"note": f"Edge looks off, {len(who)}"} if object_id == "T1" else body
            saved = answer(api, r, str(r.task), object_id, noted, who)
            assert saved.status_code == 200, saved.text
        assert api(r.people[who]).post(f"{r.base}/submit").status_code == 200
    return r, f"/api/review-tasks/{r.task}"


def send(api: ApiAs, r: Review, task: str, who: str, objects: list[str], note: str | None = None):
    body: dict[str, Any] = {
        "adjudicator_user_id": str(r.people[who].user_id),
        "objects": [{"slide_id": str(r.slide), "object": item} for item in objects],
    }
    if note is not None:
        body["note"] = note
    return api(r.people["owner"]).post(f"{task}/disagreements/adjudications", json=body)


def keys_of(value: object) -> set[str]:
    if isinstance(value, dict):
        mapping = cast(dict[str, object], value)
        return set(mapping) | {key for item in mapping.values() for key in keys_of(item)}
    if isinstance(value, list):
        return {key for item in cast(list[object], value) for key in keys_of(item)}
    return set()


def by_object(queue: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {item["object"]: item for item in queue}


def test_several_objects_go_to_one_adjudicator_who_sees_reviewers_only_as_letters(
    api: ApiAs, database: str
) -> None:
    r, task = queued(api, database)
    candidates = api(r.people["owner"]).get(f"{task}/disagreements/adjudicators")
    assert candidates.status_code == 200, candidates.text
    flags = {item["user_id"]: item["reviewer_of_task"] for item in candidates.json()}
    assert flags[str(r.people["first"].user_id)] is True
    assert flags[str(r.people["third"].user_id)] is False
    refused = send(api, r, task, "first", ["T1"])
    assert (refused.status_code, refused.json()["code"]) == (409, "reviewer-of-task")
    agreed = send(api, r, task, "third", ["C1"])
    assert agreed.status_code == 404
    sent = send(api, r, task, "third", ["T1", "T2", "T1"], note="Please look at the edges")
    assert sent.status_code == 201, sent.text
    assert [item["object"] for item in sent.json()] == ["T1", "T2"]
    assert {item["adjudication"]["note"] for item in sent.json()} == {"Please look at the edges"}
    told = owner(
        database,
        "SELECT kind, payload->>'objects' FROM notifications "
        f"WHERE user_id = '{r.people['third'].user_id}'",
    )
    assert told == [("adjudication-requested", "2")]
    blocked = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (blocked.status_code, blocked.json()["code"]) == (409, "disagreements-open")
    taken = api(r.people["owner"]).put(
        f"{task}/disagreements/{r.slide}/T1", json={"answer": "agree"}
    )
    assert (taken.status_code, taken.json()["code"]) == (409, "with-adjudicator")
    again = send(api, r, task, "viewer", ["T1"])
    assert again.status_code == 201, again.text

    seen = api(r.people["third"]).get("/api/adjudications/objects", params={"task_id": str(r.task)})
    assert seen.status_code == 200, seen.text
    items = by_object(seen.json())
    assert list(items) == ["T2"]
    seen = api(r.people["viewer"]).get("/api/adjudications/objects").json()
    items = by_object(seen + api(r.people["third"]).get("/api/adjudications/objects").json())
    assert keys_of(seen) & PERSONAL_KEYS == set()
    text = json.dumps(items)
    names = owner(
        database,
        "SELECT id, display_name FROM users "
        f"WHERE id IN ('{r.people['first'].user_id}', '{r.people['second'].user_id}')",
    )
    for user_id, name in names:
        assert str(user_id) not in text
        assert str(name) not in text
    first_on_t1 = next(
        given["reviewer"]
        for given in items["T1"]["reviewer_decisions"]
        if given["value"] == "agree"
    )
    first_on_t2 = next(
        given["reviewer"]
        for given in items["T2"]["reviewer_decisions"]
        if given["reasons"] == ["not_class"]
    )
    assert first_on_t1 == first_on_t2
    assert sorted(given["reviewer"] for given in items["T1"]["reviewer_decisions"]) == ["A", "B"]
    assert {given["note"] for given in items["T1"]["reviewer_decisions"]} == {
        "Edge looks off, 5",
        "Edge looks off, 6",
    }
    assert items["T2"]["note"] == "Please look at the edges"
    summary = api(r.people["third"]).get("/api/adjudications")
    assert summary.status_code == 200, summary.text
    [mine] = summary.json()
    assert (mine["objects"], mine["decided"]) == (["T2"], 0)
    assert mine["asked_by_user_id"] == str(r.people["owner"].user_id)
    assert mine["task_code"].startswith("RT-")


def test_a_declined_send_goes_to_someone_else_whose_decision_sits_beside_the_reviewers(
    api: ApiAs, database: str
) -> None:
    r, task = queued(api, database)
    sent = send(api, r, task, "third", ["T1", "T2"])
    adjudication = sent.json()[0]["adjudication"]["id"]
    declined = api(r.people["third"]).post(
        f"/api/adjudications/{adjudication}/decline", json={"note": "Not my field"}
    )
    assert declined.status_code == 204, declined.text
    twice = api(r.people["third"]).post(f"/api/adjudications/{adjudication}/decline", json={})
    assert (twice.status_code, twice.json()["code"]) == (409, "adjudication-declined")
    rows = by_object(api(r.people["owner"]).get(f"{task}/disagreements").json())
    assert rows["T1"]["adjudication"]["declined_note"] == "Not my field"
    assert rows["T1"]["adjudication"]["declined_at"] is not None
    assert api(r.people["third"]).get("/api/adjudications/objects").json() == []
    late = api(r.people["third"]).put(
        f"/api/adjudications/{r.task}/{r.slide}/T1", json={"answer": "agree"}
    )
    assert late.status_code == 404

    assert send(api, r, task, "viewer", ["T1", "T2"]).status_code == 201
    decided = api(r.people["viewer"]).put(
        f"/api/adjudications/{r.task}/{r.slide}/T1", json={"answer": "disagree"}
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["decision"]["value"] == "disagree"
    assert keys_of(decided.json()) & PERSONAL_KEYS == set()
    rows = by_object(api(r.people["owner"]).get(f"{task}/disagreements").json())
    assert rows["T1"]["decision"]["decided_by_user_id"] == str(r.people["viewer"].user_id)
    assert rows["T1"]["adjudication"]["adjudicator_user_id"] == str(r.people["viewer"].user_id)
    beside = decided.json()["reviewer_decisions"]
    assert sorted(given["value"] for given in beside) == ["agree", "disagree"]
    still = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (still.status_code, still.json()["code"]) == (409, "disagreements-open")
    api(r.people["viewer"]).put(
        f"/api/adjudications/{r.task}/{r.slide}/T2", json={"answer": "agree"}
    )
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    actions = [
        row[0]
        for row in owner(
            database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
        )
        if str(row[0]).startswith(("review.adjudication", "review.decision"))
    ]
    assert actions == [
        "review.adjudication-sent",
        "review.adjudication-declined",
        "review.adjudication-sent",
        "review.decision-set",
        "review.decision-set",
    ]


def test_another_workspace_and_other_members_cannot_touch_adjudications(
    api: ApiAs, database: str
) -> None:
    r, task = queued(api, database)
    adjudication = send(api, r, task, "third", ["T1"]).json()[0]["adjudication"]["id"]
    stranger = review(api, database).people["owner"]
    for method, url, body in (
        ("GET", f"{task}/disagreements/adjudicators", None),
        (
            "POST",
            f"{task}/disagreements/adjudications",
            {
                "adjudicator_user_id": str(r.people["third"].user_id),
                "objects": [{"slide_id": str(r.slide), "object": "T2"}],
            },
        ),
        ("PUT", f"/api/adjudications/{r.task}/{r.slide}/T1", {"answer": "agree"}),
        ("POST", f"/api/adjudications/{adjudication}/decline", {}),
    ):
        response = api(stranger).request(method, url, json=body)
        assert response.status_code == 404, (method, url, response.text)
    assert api(stranger).get("/api/adjudications/objects").json() == []
    assert api(stranger).get("/api/adjudications").json() == []
    other = api(r.people["viewer"]).put(
        f"/api/adjudications/{r.task}/{r.slide}/T1", json={"answer": "agree"}
    )
    assert other.status_code == 404
    reviewer = api(r.people["third"]).post(
        f"{task}/disagreements/adjudications",
        json={
            "adjudicator_user_id": str(r.people["viewer"].user_id),
            "objects": [{"slide_id": str(r.slide), "object": "T2"}],
        },
    )
    assert reviewer.status_code in (403, 404)
    counted = owner(
        database, f"SELECT count(*) FROM adjudication_objects WHERE task_id = '{r.task}'"
    )
    assert counted == [(1,)]
