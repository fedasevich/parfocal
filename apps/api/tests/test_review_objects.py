import pytest
from db_support import ApiAs
from order_support import run_orders
from submit_support import submitted as finished_submit
from test_adjudications import queued, send
from test_review_order import made, ordered
from test_reviewed_layer import review
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def test_review_objects_follow_the_order_with_the_ai_call(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = made(api, o, {"kind": "inside-rois"})
    run_orders(database, o.tenant)
    base = f"/api/review-tasks/{task}/slides/{o.slides[0]}"
    order = api(o.people["first"]).get(f"{base}/order").json()["objects"]
    listed = api(o.people["first"]).get(f"{base}/objects")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert (body["task_id"], body["slide_id"]) == (str(task), str(o.slides[0]))
    assert body["slide"]["stain"]
    assert [item["object"] for item in body["objects"]] == [item["object"] for item in order]
    by_id = {item["object"]: item for item in body["objects"]}
    assert by_id["T3"]["kind"] == "region"
    assert by_id["T3"]["number"] == 3
    assert 0 <= by_id["T3"]["score"] <= 1
    assert by_id["C1"]["kind"] == "cell"
    assert len(by_id["C1"]["outline"]) >= 6
    assert by_id["C2"]["score"] == pytest.approx(155 / 255, abs=0.01)
    assert body["added"] == []
    assert api(o.people["third"]).get(f"{base}/objects").status_code == 404


def test_hidden_ai_lists_no_objects_during_a_first_read(api: ApiAs, database: str) -> None:
    r = review(api, database)
    owner(database, f"UPDATE review_tasks SET ai_hidden_first_read = true WHERE id = '{r.task}'")
    hidden = api(r.people["first"]).get(f"{r.base}/objects").json()
    assert hidden["objects"] == []
    shown = api(r.people["owner"]).get(f"{r.base}/objects").json()
    assert [item["object"] for item in shown["objects"]] == ["T1", "T2"]
    assert shown["objects"][0]["size_mm"] is None or shown["objects"][0]["size_mm"] > 0


def test_agreement_counts_only_after_both_reviewers_submit(api: ApiAs, database: str) -> None:
    r = review(api, database)
    url = f"{r.base}/agreement"
    for who, value in (("first", "agree"), ("second", "agree")):
        api(r.people[who]).put(f"{r.base}/decisions/T1", json={"value": value})
    api(r.people["first"]).put(f"{r.base}/decisions/T2", json={"value": "agree"})
    api(r.people["second"]).put(
        f"{r.base}/decisions/T2", json={"value": "disagree", "reasons": ["artefact"]}
    )
    before = api(r.people["first"]).get(url).json()
    assert (before["with_user_id"], before["total"]) == (None, 0)
    for who in ("first", "second"):
        assert finished_submit(api(r.people[who]), r.base).status_code == 200
    after = api(r.people["first"]).get(url).json()
    assert after["with_user_id"] == str(r.people["second"].user_id)
    assert (after["agree"], after["total"]) == (1, 2)
    assert api(r.people["owner"]).get(url).json()["with_user_id"] is None


def test_task_display_shows_locks_and_my_presets(api: ApiAs, database: str) -> None:
    r = review(api, database)
    locked = api(r.people["owner"]).patch(
        f"/api/review-tasks/{r.task}",
        json={"display": {"locks": {"order": "Everyone sees the same order"}}},
    )
    assert locked.status_code == 200, locked.text
    saved = api(r.people["first"]).post(
        "/api/display-presets", json={"name": "Dots", "settings": {"draw_as": "dots"}}
    )
    assert saved.status_code == 201, saved.text
    display = api(r.people["first"]).get(f"/api/review-tasks/{r.task}/display")
    assert display.status_code == 200, display.text
    body = display.json()
    assert body["task_code"].startswith("RT-")
    assert body["locks"] == [
        {"setting": "order", "value": "ai", "reason": "Everyone sees the same order"}
    ]
    assert [(preset["name"], preset["key"]) for preset in body["presets"]] == [("Dots", "⇧2")]
    assert body["presets"][0]["settings"]["draw_as"] == "dots"
    assert (
        api(r.people["second"]).get(f"/api/review-tasks/{r.task}/display").json()["presets"] == []
    )
    assert api(r.people["viewer"]).get(f"/api/review-tasks/{r.task}/display").status_code == 403


def test_the_queue_lists_rows_and_takes_each_action(api: ApiAs, database: str) -> None:
    r, task = queued(api, database)
    queue = api(r.people["owner"]).get(f"{task}/disagreement-queue")
    assert queue.status_code == 200, queue.text
    body = queue.json()
    assert body["locked"] is None
    assert body["total_objects"] == 2
    rows = {row["object"]: row for row in body["rows"]}
    assert set(rows) == {"T1", "T2"}
    assert (rows["T1"]["tag"], rows["T2"]["tag"]) == ("differ", "bothai")
    assert rows["T1"]["state"] == "open"
    assert rows["T1"]["key"].endswith(":T1")
    assert sorted(item["raw"] for item in rows["T1"]["answers"]) == ["agree", "disagree"]
    assert "Boundary is off" in [item["reason"] for item in rows["T1"]["answers"]]
    assert rows["T1"]["ai"]["score"] == pytest.approx(200 / 255, abs=0.01)
    url = f"{task}/disagreement-queue/{r.slide}"
    decided = api(r.people["owner"]).post(
        f"{url}/T1", json={"action": "decide", "raw": "agree", "note": "Edge"}
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["state"] == "decided"
    assert decided.json()["decision"]["raw"] == "agree"
    assert decided.json()["decision"]["by_user_id"] == str(r.people["owner"].user_id)
    left = api(r.people["owner"]).post(f"{url}/T2", json={"action": "leave-open"})
    assert left.json()["state"] == "left-open"
    missing = api(r.people["owner"]).post(f"{url}/T2", json={"action": "decide"})
    assert (missing.status_code, missing.json()["code"]) == (400, "answer-needed")
    first = api(r.people["first"]).post(f"{url}/T1", json={"action": "decide", "raw": "agree"})
    assert first.status_code == 403
    hidden = api(r.people["first"]).get(f"{task}/disagreement-queue")
    assert (hidden.status_code, hidden.json()["code"]) == (403, "disagreements-hidden")


def test_the_queue_is_locked_while_reviews_are_out(api: ApiAs, database: str) -> None:
    r = review(api, database)
    api(r.people["first"]).put(f"{r.base}/decisions/T1", json={"value": "agree"})
    finished_submit(api(r.people["first"]), r.base)
    body = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/disagreement-queue").json()
    assert body["locked"] == {"user_id": str(r.people["second"].user_id), "slides_left": 1}
    assert body["rows"] == []


def test_the_adjudicator_sees_anonymous_answers_and_decides(api: ApiAs, database: str) -> None:
    r, task = queued(api, database)
    assert send(api, r, task, "third", ["T1"], note="Please look").status_code == 201
    rows = api(r.people["owner"]).get(f"{task}/disagreement-queue").json()["rows"]
    assert {row["object"]: row["state"] for row in rows}["T1"] == "with-adjudicator"
    mine = api(r.people["third"]).get(f"{task}/adjudication")
    assert mine.status_code == 200, mine.text
    body = mine.json()
    assert (body["note"], body["asked_by_user_id"]) == (
        "Please look",
        str(r.people["owner"].user_id),
    )
    assert [item["object"] for item in body["objects"]] == ["T1"]
    shown = body["objects"][0]
    assert sorted([shown["reviewer_a"]["raw"], shown["reviewer_b"]["raw"]]) == ["agree", "disagree"]
    assert "user_id" not in shown["reviewer_a"]
    assert shown["decision"] is None
    decided = api(r.people["third"]).post(
        f"{task}/adjudication/{r.slide}/T1", json={"raw": "disagree", "note": "Off"}
    )
    assert decided.status_code == 200, decided.text
    assert (decided.json()["decision"], decided.json()["decision_note"]) == ("disagree", "Off")
    rows = api(r.people["owner"]).get(f"{task}/disagreement-queue").json()["rows"]
    assert {row["object"]: row["state"] for row in rows}["T1"] == "adjudicated"
    assert api(r.people["first"]).get(f"{task}/adjudication").status_code == 404
