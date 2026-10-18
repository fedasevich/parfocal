from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import SQUARE, Review, review
from workspace_support import owner

from parfocal_api.principals import MemberPrincipal

pytestmark = pytest.mark.db


def verdict(api: ApiAs, r: Review, who: str, object_id: str, body: dict[str, Any]) -> Any:
    return api(r.people[who]).put(f"{r.base}/verdicts/{object_id}", json=body)


def listed(api: ApiAs, r: Review, who: str, reviewer: MemberPrincipal | None = None) -> Any:
    params = {"reviewer_id": str(reviewer.user_id)} if reviewer else {}
    return api(r.people[who]).get(f"{r.base}/verdicts", params=params)


def layer_classes(api: ApiAs, r: Review) -> dict[str, Any]:
    edits = api(r.people["first"]).get(f"{r.base}/layer").json()["edits"]
    return {edit["object"]: (edit["class_id"], edit["geometry"] is not None) for edit in edits}


def test_each_verdict_is_saved_listed_and_audited(api: ApiAs, database: str) -> None:
    r = review(api, database)
    agree = verdict(api, r, "first", "T1", {"value": "agree"})
    assert agree.status_code == 200, agree.text
    assert agree.json()["object"] == "T1"
    assert verdict(api, r, "first", "T2", {"value": "unsure"}).status_code == 200
    note = "Looks like a crush artefact near the edge"
    disagree = verdict(
        api, r, "first", "C1", {"value": "disagree", "reason": "not_a_cell", "note": note}
    )
    assert disagree.json()["note"] == note
    mine = listed(api, r, "first").json()
    assert [(v["object"], v["value"], v["reason"]) for v in mine] == [
        ("C1", "disagree", "not_a_cell"),
        ("T1", "agree", None),
        ("T2", "unsure", None),
    ]
    actions = owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq",
    )
    assert [row[0] for row in actions][1:] == ["review.verdict-set"] * 3
    assert note not in str(actions)


def test_a_verdict_changes_and_clearing_is_undo(api: ApiAs, database: str) -> None:
    r = review(api, database)
    verdict(api, r, "first", "T1", {"value": "agree"})
    changed = verdict(api, r, "first", "T1", {"value": "disagree", "reason": "boundary_off"})
    assert (changed.json()["value"], changed.json()["reason"]) == ("disagree", "boundary_off")
    assert len(listed(api, r, "first").json()) == 1
    assert api(r.people["first"]).delete(f"{r.base}/verdicts/T1").status_code == 204
    assert listed(api, r, "first").json() == []
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
    )
    assert [row[0] for row in actions][-1] == "review.verdict-cleared"


def test_wrong_class_retypes_the_cell_in_the_layer_together(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tumor = str(r.tumor)
    wrong = {"value": "disagree", "reason": "wrong_class", "reason_class_id": tumor}
    assert verdict(api, r, "first", "C2", wrong).status_code == 200
    assert layer_classes(api, r) == {"C2": (tumor, False)}
    assert verdict(api, r, "first", "C2", {"value": "agree"}).status_code == 200
    assert layer_classes(api, r) == {}
    verdict(api, r, "first", "C2", wrong)
    api(r.people["first"]).put(f"{r.base}/edits/C2", json={"class_id": tumor, "geometry": SQUARE})
    assert api(r.people["first"]).delete(f"{r.base}/verdicts/C2").status_code == 204
    assert layer_classes(api, r) == {"C2": (None, True)}


@pytest.mark.parametrize(
    ("object_id", "body", "status", "code"),
    [
        ("T1", {"value": "disagree"}, 422, "validation"),
        ("T1", {"value": "agree", "reason": "artefact"}, 422, "validation"),
        ("C1", {"value": "disagree", "reason": "wrong_class"}, 422, "validation"),
        ("T1", {"value": "maybe"}, 422, "validation"),
        ("T1", {"value": "disagree", "reason": "not_a_cell"}, 400, "reason-not-for-kind"),
        ("C1", {"value": "disagree", "reason": "two_regions"}, 400, "reason-not-for-kind"),
        ("T9", {"value": "agree"}, 404, "unknown-object"),
        ("R1", {"value": "agree"}, 400, "not-an-ai-object"),
        ("T1", {"value": "agree", "note": "x" * 501}, 422, "validation"),
    ],
)
def test_bad_verdicts_are_refused(
    api: ApiAs, database: str, object_id: str, body: dict[str, Any], status: int, code: str
) -> None:
    r = review(api, database)
    response = verdict(api, r, "first", object_id, body)
    assert (response.status_code, response.json()["code"]) == (status, code), response.text


def test_verdicts_lock_at_sign_off_and_open_again_on_reopen(api: ApiAs, database: str) -> None:
    r = review(api, database)
    verdict(api, r, "first", "T1", {"value": "agree"})
    task = f"/api/review-tasks/{r.task}"
    for who in ("first", "second"):
        assert api(r.people[who]).post(f"{r.base}/submit").status_code == 200
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    late = verdict(api, r, "first", "T1", {"value": "unsure"})
    assert (late.status_code, late.json()["code"]) == (409, "task-signed-off")
    assert api(r.people["first"]).delete(f"{r.base}/verdicts/T1").status_code == 409
    assert api(r.people["owner"]).post(f"{task}/reopen").status_code == 200
    assert verdict(api, r, "first", "T1", {"value": "unsure"}).status_code == 200


def test_each_reviewer_sees_their_own_verdicts_and_the_owner_sees_all(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    verdict(api, r, "first", "T1", {"value": "agree"})
    assert listed(api, r, "second").json() == []
    peek = listed(api, r, "second", r.people["first"])
    assert (peek.status_code, peek.json()["code"]) == (403, "other-reviewer")
    assert len(listed(api, r, "owner", r.people["first"]).json()) == 1
    assert verdict(api, r, "viewer", "T1", {"value": "agree"}).json()["code"] == "not-assigned"
    assert verdict(api, r, "third", "T1", {"value": "agree"}).status_code == 404


def test_a_verdict_puts_the_reviewer_in_review(api: ApiAs, database: str) -> None:
    r = review(api, database)
    verdict(api, r, "second", "T2", {"value": "agree"})
    slides = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/states").json()["slides"]
    by_user = {item["user_id"]: item["state"] for item in slides[0]["reviewers"]}
    assert by_user[str(r.people["second"].user_id)] == "in-review"
    assert by_user[str(r.people["first"].user_id)] == "assigned"
