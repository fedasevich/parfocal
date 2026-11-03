import uuid

import pytest
from db_support import ApiAs
from test_decision_styles import ai_says_tumor, answer, task_of
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

VERDICTS = {
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
    kept = api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree", "note": "Edge"})
    assert kept.status_code == 200, kept.text
    assert (kept.json()["decision"]["value"], kept.json()["note"]) == ("agree", "Edge")
    still = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (still.status_code, still.json()["code"]) == (409, "disagreements-open")
    changed = api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "disagree"})
    assert changed.json()["decision"]["value"] == "disagree"
    assert api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "agree"}).status_code == 200
    slides = api(r.people["owner"]).get(f"{task}/states").json()["slides"]
    assert slides[0]["state"] == "submitted"
    assert api(r.people["owner"]).delete(f"{decide}/T2").status_code == 204
    assert api(r.people["owner"]).get(f"{task}/states").json()["slides"][0]["state"] == (
        "disagreement-queue"
    )
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "agree"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    late = api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
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
    viewer = api(r.people["viewer"]).put(f"{decide}/T1", json={"answer": "agree"})
    assert (viewer.status_code, viewer.json()["code"]) == (403, "project-owners-only")
    assert api(r.people["first"]).put(f"{decide}/T1", json={"answer": "agree"}).status_code == 403
    agreed = api(r.people["owner"]).put(f"{decide}/C1", json={"answer": "agree"})
    assert (agreed.status_code, agreed.json()["code"]) == (404, "not-queued")
    assert api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "maybe"}).status_code == 400


STYLES = [
    ({"style": "certainty"}, ("5", "1"), {"answer": "2"}, "disagree"),
    ({"style": "agree"}, ("agree", "disagree"), {"answer": "unsure"}, "unsure"),
    (
        {"style": "yes-no", "question": "Is this tumor?"},
        ("yes", "no"),
        {"answer": "no"},
        "disagree",
    ),
    ({"style": "blind"}, ("tumor", "stroma"), {"answer": "class", "class": "tumor"}, "agree"),
]


def press(given: str, classes: dict[str, uuid.UUID]) -> dict[str, str]:
    if given in classes:
        return {"answer": "class", "answer_class_id": str(classes[given])}
    return {"answer": given}


@pytest.mark.parametrize(("decision", "reviewers", "pressed", "value"), STYLES)
def test_a_queue_decision_takes_the_task_style_and_stores_what_it_counts_as(
    api: ApiAs,
    database: str,
    decision: dict[str, str],
    reviewers: tuple[str, str],
    pressed: dict[str, str],
    value: str,
) -> None:
    r = review(api, database)
    classes = {"tumor": r.tumor, "stroma": ai_says_tumor(database, r)}
    task = task_of(api, r, decision)
    for who, given in zip(("first", "second"), reviewers, strict=True):
        assert answer(api, r, task, "T1", press(given, classes), who).status_code == 200
        submitted = api(r.people[who]).post(f"/api/review-tasks/{task}/slides/{r.slide}/submit")
        assert submitted.status_code == 200, submitted.text
    url = f"/api/review-tasks/{task}/disagreements/{r.slide}/T1"
    body = {"answer": pressed["answer"]}
    if "class" in pressed:
        body["answer_class_id"] = str(classes[pressed["class"]])
    decided = api(r.people["owner"]).put(url, json=body)
    assert decided.status_code == 200, decided.text
    stored = decided.json()["decision"]
    assert (stored["style"], stored["answer"], stored["value"], stored["choice"]) == (
        decision["style"],
        pressed["answer"],
        value,
        None,
    )
    wrong = api(r.people["owner"]).put(url, json={"answer": "maybe"})
    assert (wrong.status_code, wrong.json()["code"]) == (400, "answer-not-in-style")
    evaluated = api(r.people["owner"]).get(f"/api/review-tasks/{task}/evaluation")
    assert evaluated.status_code == 200, evaluated.text


def test_a_certainty_decision_is_recounted_when_counts_as_changes(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    task = task_of(api, r, {"style": "certainty"})
    for who, given in (("first", "5"), ("second", "1")):
        answer(api, r, task, "T1", {"answer": given}, who)
        api(r.people[who]).post(f"/api/review-tasks/{task}/slides/{r.slide}/submit")
    url = f"/api/review-tasks/{task}/disagreements/{r.slide}/T1"
    decided = api(r.people["owner"]).put(url, json={"answer": "2"})
    assert decided.json()["decision"]["value"] == "disagree"
    counts_as = ["disagree", "unsure", "unsure", "agree", "agree"]
    changed = api(r.people["owner"]).patch(
        f"/api/review-tasks/{task}",
        json={"decision": {"style": "certainty", "counts_as": counts_as}},
    )
    assert changed.status_code == 200, changed.text
    queue = api(r.people["owner"]).get(f"/api/review-tasks/{task}/disagreements").json()
    assert queue[0]["decision"]["value"] == "unsure"


def test_the_old_two_choices_read_back_as_agree_and_disagree(api: ApiAs, database: str) -> None:
    r, task = queued_review(api, database)
    for number, choice, value in ((1, "keep-ai", "agree"), (2, "go-with-reviewers", "disagree")):
        owner(
            database,
            "INSERT INTO disagreement_decisions (tenant_id, project_id, task_id, slide_id, kind, "
            f"number, decision, value) SELECT tenant_id, id, '{r.task}', '{r.slide}', 'region', "
            f"{number}, '{choice}', '{value}' FROM projects WHERE id = '{r.project}'",
        )
    queue = api(r.people["owner"]).get(f"{task}/disagreements").json()
    assert [
        (item["object"], item["decision"]["choice"], item["decision"]["value"]) for item in queue
    ] == [("T1", "keep-ai", "agree"), ("T2", "go-with-reviewers", "disagree")]
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200


QUEUE_ACTIONS = {"review.decision-set", "review.decision-cleared", "review.object-left-open"}


def test_leaving_open_counts_as_settled_for_sign_off_and_can_be_undone(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    left = api(r.people["owner"]).put(f"{decide}/T2/left-open", json={"note": "Ask Lenka"})
    assert left.status_code == 200, left.text
    assert (left.json()["left_open"], left.json()["decision"], left.json()["note"]) == (
        True,
        None,
        "Ask Lenka",
    )
    states = api(r.people["owner"]).get(f"{task}/states").json()
    assert (states["slides"][0]["state"], states["left_open"]) == ("submitted", 1)
    assert api(r.people["owner"]).delete(f"{decide}/T2").status_code == 204
    reopened = api(r.people["owner"]).get(f"{task}/disagreements").json()[1]
    assert (reopened["left_open"], reopened["decision"]) == (False, None)
    refused = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (refused.status_code, refused.json()["code"]) == (409, "disagreements-open")
    assert api(r.people["owner"]).put(f"{decide}/T2/left-open", json={}).status_code == 200
    signed = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (signed.status_code, signed.json()["left_open"]) == (200, 1)
    late = api(r.people["owner"]).put(f"{decide}/T2/left-open", json={})
    assert (late.status_code, late.json()["code"]) == (409, "task-signed-off")
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
    )
    assert [row[0] for row in actions if row[0] in QUEUE_ACTIONS] == [
        "review.decision-set",
        "review.object-left-open",
        "review.decision-cleared",
        "review.object-left-open",
    ]


def test_a_reviewer_asking_for_a_second_look_queues_the_object(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for who, reasons in (("first", ["need_second_look"]), ("second", ["need_ihc"])):
        body = {"value": "unsure", "reasons": reasons}
        assert api(r.people[who]).put(f"{r.base}/verdicts/T1", json=body).status_code == 200
        api(r.people[who]).put(f"{r.base}/verdicts/T2", json={"value": "unsure"})
        api(r.people[who]).post(f"{r.base}/submit")
    queue = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreements").json()
    assert [(item["object"], item["why"]) for item in queue] == [("T1", "second-look")]


def redraw(api: ApiAs, r: Review, square: int) -> None:
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [square, 0], [square, square], [0, square], [0, 0]]],
    }
    saved = api(r.people["first"]).put(f"{r.base}/edits/T1", json={"geometry": geometry})
    assert saved.status_code == 200, saved.text


def test_an_object_redrawn_after_decisions_is_kept_or_sent_back(api: ApiAs, database: str) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    researcher = r.people["owner"]
    unedited = api(researcher).post(f"{decide}/T1/keep-decisions")
    assert (unedited.status_code, unedited.json()["code"]) == (409, "not-edited-after-decisions")
    api(researcher).put(f"{decide}/T1", json={"answer": "agree"})
    api(researcher).put(f"{decide}/T2", json={"answer": "agree"})
    redraw(api, r, 40)
    tagged = api(researcher).get(f"{task}/disagreements").json()[0]
    assert (tagged["edited_after_decisions"], tagged["decision"]["value"]) == (True, "agree")
    kept = api(researcher).post(f"{decide}/T1/keep-decisions")
    assert kept.status_code == 200, kept.text
    assert (kept.json()["edited_after_decisions"], kept.json()["decision"]["value"]) == (
        False,
        "agree",
    )
    redraw(api, r, 30)
    again = api(researcher).post(f"{decide}/T1/look-again", json={"note": "Outline changed"})
    assert again.status_code == 200, again.text
    body = again.json()
    assert (body["looking_again"], body["edited_after_decisions"], body["decision"]) == (
        True,
        False,
        None,
    )
    assert [verdict["reopened"] for verdict in body["verdicts"]] == [True, True]
    notes = owner(
        database,
        "SELECT DISTINCT reopened_note FROM verdicts "
        f"WHERE task_id = '{r.task}' AND kind = 'region' AND number = 1",
    )
    assert notes == [("Outline changed",)]
    listed = api(r.people["second"]).get(f"{r.base}/verdicts").json()
    assert [item["reopened_note"] for item in listed if item["object"] == "T1"] == [
        "Outline changed"
    ]
    blocked = api(researcher).put(f"{decide}/T1", json={"answer": "agree"})
    assert (blocked.status_code, blocked.json()["code"]) == (409, "looking-again")
    refused = api(researcher).post(f"{task}/sign-off")
    assert (refused.status_code, refused.json()["code"]) == (409, "disagreements-open")
    for who, given in (("first", {"value": "agree"}), ("second", {"value": "disagree"})):
        assert api(r.people[who]).put(f"{r.base}/verdicts/T1", json=given).status_code == 200
    settled = api(researcher).get(f"{task}/disagreements").json()[0]
    assert (settled["looking_again"], settled["edited_after_decisions"]) == (False, False)
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
    )
    named = [str(row[0]) for row in actions]
    assert named.count("review.look-again-asked") == 1
    assert named.count("review.decisions-kept") == 1


def test_another_workspace_cannot_touch_the_queue(api: ApiAs, database: str) -> None:
    r, task = queued_review(api, database)
    stranger = review(api, database).people["owner"]
    decide = f"{task}/disagreements/{r.slide}/T1"
    for method, url, body in (
        ("PUT", decide, {"answer": "agree"}),
        ("PUT", f"{decide}/left-open", {}),
        ("POST", f"{decide}/look-again", {}),
        ("POST", f"{decide}/keep-decisions", None),
        ("DELETE", decide, None),
        ("GET", f"{task}/disagreements", None),
    ):
        response = api(stranger).request(method, url, json=body)
        assert response.status_code == 404, (method, url, response.text)
    counted = owner(
        database, f"SELECT count(*) FROM disagreement_decisions WHERE task_id = '{r.task}'"
    )
    assert counted == [(0,)]
