import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_tasks import Study, create, study
from workspace_support import owner

pytestmark = pytest.mark.db


def made(api: ApiAs, s: Study, **changes: Any) -> dict[str, Any]:
    response = create(api, s, **changes)
    assert response.status_code == 201, response.text
    return response.json()


def as_owner(api: ApiAs, s: Study) -> Any:
    return api(s.people["owner"])


def give_decision(database: str, s: Study, task_id: str, slide: uuid.UUID, who: str) -> None:
    owner(
        database,
        "INSERT INTO review_decisions (tenant_id, project_id, task_id, slide_id, user_id, "
        "kind, number, "
        "value, style, answer) VALUES "
        f"('{s.tenant_id}', '{s.project}', '{task_id}', '{slide}', '{s.user(who)}', "
        "'region', 1, 'agree', 'agree', 'agree')",
    )


def notices(database: str, s: Study, who: str, kind: str) -> list[dict[str, Any]]:
    rows = owner(
        database,
        f"SELECT payload FROM notifications WHERE user_id = '{s.user(who)}' AND kind = '{kind}'",
    )
    return [row[0] if isinstance(row[0], dict) else json.loads(str(row[0])) for row in rows]


def audited(database: str, task_id: str, action: str) -> list[dict[str, Any]]:
    rows = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{task_id}' AND action = '{action}'",
    )
    return [json.loads(str(row[0])) for row in rows]


def reviewers_of(task: dict[str, Any]) -> list[list[str]]:
    return [slide["reviewer_ids"] for slide in task["slides"]]


def detail(api: ApiAs, s: Study, task_id: str) -> dict[str, Any]:
    response = as_owner(api, s).get(f"/api/review-tasks/{task_id}")
    assert response.status_code == 200, response.text
    return response.json()


def reassign(api: ApiAs, s: Study, task_id: str, **body: Any) -> Any:
    return as_owner(api, s).post(f"/api/review-tasks/{task_id}/reassignments", json=body)


def test_a_nudge_tells_the_reviewer_and_audits_without_the_message(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    task = made(api, s, split="even")
    url = f"/api/review-tasks/{task['id']}/nudges"
    message = "Two slides are left. Could you fit them in this week?"
    sent = as_owner(api, s).post(url, json={"user_id": s.user("first"), "message": message})
    assert sent.status_code == 201, sent.text
    nudge = sent.json()
    assert (nudge["task_id"], nudge["user_id"]) == (task["id"], s.user("first"))
    assert [notice["message"] for notice in notices(database, s, "first", "task-nudged")] == [
        message
    ]
    (details,) = audited(database, task["id"], "task.nudged")
    assert details["message_length"] == len(message)
    assert message not in json.dumps(details)
    assert s.user("first") not in json.dumps(details)
    outsider = {"user_id": s.user("viewer"), "message": "Hi"}
    assert as_owner(api, s).post(url, json=outsider).json()["code"] == "not-on-task"
    empty = {"user_id": s.user("first"), "message": "  "}
    assert as_owner(api, s).post(url, json=empty).status_code == 422
    reviewer = api(s.people["second"]).post(url, json={"user_id": s.user("first"), "message": "Hi"})
    assert reviewer.status_code in {403, 404}
    cancelled = as_owner(api, s).delete(f"{url}/{nudge['id']}")
    assert cancelled.status_code == 204, cancelled.text
    assert notices(database, s, "first", "task-nudged") == []
    assert len(audited(database, task["id"], "task.nudge-cancelled")) == 1
    again = as_owner(api, s).delete(f"{url}/{nudge['id']}")
    assert (again.status_code, again.json()["code"]) == (404, "nudge-not-found")


def test_a_reassign_moves_only_slides_not_started_by_default(api: ApiAs, database: str) -> None:
    s = study(database)
    task = made(api, s, split="even")
    first, third = s.user("first"), s.user("third")
    assert reviewers_of(task) == [[first], [s.user("second")], [third], [first]]
    give_decision(database, s, task["id"], s.slides[0], "first")
    moved = reassign(api, s, task["id"], from_user_id=first, to_user_id=third, note="For you")
    assert moved.status_code == 201, moved.text
    body = moved.json()
    assert (body["moved_slide_ids"], body["kept_slide_ids"]) == ([str(s.slides[3])], [])
    assert (body["what"], body["slides_moved"]) == ("not-started", 1)
    assert reviewers_of(detail(api, s, task["id"])) == [
        [first],
        [s.user("second")],
        [third],
        [third],
    ]
    away = notices(database, s, "first", "task-reassigned")
    to_you = notices(database, s, "third", "task-reassigned")
    assert [(n["direction"], n["slides"], n["note"]) for n in away + to_you] == [
        ("away", 1, "For you"),
        ("to-you", 1, "For you"),
    ]
    (details,) = audited(database, task["id"], "task.reassigned")
    assert (details["what"], details["moved"], details["kept"], details["note_given"]) == (
        "not-started",
        1,
        0,
        True,
    )
    again = reassign(api, s, task["id"], from_user_id=first, to_user_id=third)
    assert (again.status_code, again.json()["code"]) == (409, "nothing-to-move")


def test_reassigning_every_slide_keeps_decisions_and_the_first_read_under_the_first_reviewer(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    task = made(api, s, split="even", ai_hidden_first_read=True)
    first, second = s.user("first"), s.user("second")
    give_decision(database, s, task["id"], s.slides[0], "first")
    owner(
        database,
        "UPDATE review_assignments SET first_read_at = now(), first_read = "
        '\'{"form_version": 1, "answers": {}, "added": []}\' '
        f"WHERE task_id = '{task['id']}' AND slide_id = '{s.slides[0]}' AND user_id = '{first}'",
    )
    moved = reassign(api, s, task["id"], from_user_id=first, to_user_id=second, what="all")
    assert moved.status_code == 201, moved.text
    body = moved.json()
    assert body["moved_slide_ids"] == [str(s.slides[0]), str(s.slides[3])]
    assert body["kept_slide_ids"] == [str(s.slides[0])]
    assert reviewers_of(detail(api, s, task["id"]))[0] == [second]
    kept = owner(
        database,
        "SELECT user_id, released_at IS NOT NULL, first_read IS NOT NULL FROM review_assignments "
        f"WHERE task_id = '{task['id']}' AND slide_id = '{s.slides[0]}' ORDER BY assigned_at",
    )
    assert [(str(user), released, read) for user, released, read in kept] == [
        (first, True, True),
        (second, False, False),
    ]
    decisions = owner(
        database,
        f"SELECT user_id FROM review_decisions WHERE task_id = '{task['id']}' "
        f"AND slide_id = '{s.slides[0]}'",
    )
    assert [str(row[0]) for row in decisions] == [first]
    gone = api(s.people["first"]).get(f"/api/review-tasks/{task['id']}")
    assert gone.status_code == 404
    first_read = as_owner(api, s).get(
        f"/api/review-tasks/{task['id']}/slides/{s.slides[0]}/first-read",
        params={"reviewer_id": first},
    )
    assert first_read.status_code == 200, first_read.text
    assert first_read.json()["reviewer_id"] == first
    back = reassign(api, s, task["id"], from_user_id=second, to_user_id=first, what="all")
    assert back.status_code == 201, back.text
    assert reviewers_of(detail(api, s, task["id"]))[0] == [first]
    restored = owner(
        database,
        "SELECT released_at IS NULL, first_read IS NOT NULL FROM review_assignments "
        f"WHERE task_id = '{task['id']}' AND slide_id = '{s.slides[0]}' AND user_id = '{first}'",
    )
    assert restored == [(True, True)]


def test_a_reassign_to_the_same_person_or_onto_a_held_slide_is_refused(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    task = made(api, s)
    first = s.user("first")
    same = reassign(api, s, task["id"], from_user_id=first, to_user_id=first)
    assert (same.status_code, same.json()["code"]) == (400, "same-reviewer")
    held = reassign(api, s, task["id"], from_user_id=first, to_user_id=s.user("second"))
    assert (held.status_code, held.json()["code"]) == (409, "already-reviews-slide")
    stranger = reassign(api, s, task["id"], from_user_id=first, to_user_id=s.user("viewer"))
    assert stranger.json()["code"] == "not-a-project-reviewer"
    nobody = reassign(api, s, task["id"], from_user_id=s.user("viewer"), to_user_id=first)
    assert nobody.json()["code"] == "not-on-task"
    assert audited(database, task["id"], "task.reassigned") == []


def test_adding_a_reviewer_assigns_slides_and_tells_them(api: ApiAs, database: str) -> None:
    s = study(database)
    task = made(api, s, split="even")
    url = f"/api/review-tasks/{task['id']}/reviewers"
    added = as_owner(api, s).post(url, json={"user_id": s.user("owner")})
    assert added.status_code == 201, added.text
    assert all(s.user("owner") in reviewers for reviewers in reviewers_of(added.json()))
    assert [n["slides"] for n in notices(database, s, "owner", "task-assigned")] == [4]
    one = as_owner(api, s).post(
        url, json={"user_id": s.user("first"), "slide_ids": [str(s.slides[1])]}
    )
    assert one.status_code == 201, one.text
    assert s.user("first") in reviewers_of(one.json())[1]
    twice = as_owner(api, s).post(url, json={"user_id": s.user("first")})
    assert (twice.status_code, twice.json()["code"]) == (409, "already-reviews-slide")
    viewer = as_owner(api, s).post(url, json={"user_id": s.user("viewer")})
    assert viewer.json()["code"] == "not-a-project-reviewer"
    foreign = {"user_id": s.user("third"), "slide_ids": [str(uuid.uuid4())]}
    assert as_owner(api, s).post(url, json=foreign).json()["code"] == "unknown-task-slide"
    assert len(audited(database, task["id"], "task.reviewer-added")) == 2


def test_changing_the_due_date_tells_reviewers_with_slides_left(api: ApiAs, database: str) -> None:
    s = study(database)
    task = made(api, s, split="even")
    owner(
        database,
        f"UPDATE review_assignments SET submitted_at = now() WHERE task_id = '{task['id']}' "
        f"AND user_id = '{s.user('second')}'",
    )
    url = f"/api/review-tasks/{task['id']}"
    changed = as_owner(api, s).patch(url, json={"due_on": "2026-12-15"})
    assert changed.status_code == 200, changed.text
    told = {
        who: [n["due_on"] for n in notices(database, s, who, "task-due-changed")]
        for who in ("first", "second", "third")
    }
    assert told == {"first": ["2026-12-15"], "second": [], "third": ["2026-12-15"]}
    as_owner(api, s).patch(url, json={"due_on": "2026-12-15"})
    assert len(notices(database, s, "first", "task-due-changed")) == 1
    renamed = as_owner(api, s).patch(url, json={"name": "Round two"})
    assert renamed.status_code == 200
    assert len(notices(database, s, "first", "task-due-changed")) == 1


def test_a_reassign_is_undone_until_the_new_reviewer_starts(api: ApiAs, database: str) -> None:
    s = study(database)
    task = made(api, s, split="even")
    first, third = s.user("first"), s.user("third")
    give_decision(database, s, task["id"], s.slides[0], "first")
    moved = reassign(api, s, task["id"], from_user_id=first, to_user_id=third, what="all")
    assert moved.status_code == 201, moved.text
    url = f"/api/review-tasks/{task['id']}/reassignments/{moved.json()['id']}"
    undone = as_owner(api, s).delete(url)
    assert undone.status_code == 204, undone.text
    assert reviewers_of(detail(api, s, task["id"])) == [
        [first],
        [s.user("second")],
        [third],
        [first],
    ]
    assert len(audited(database, task["id"], "task.reassignment-undone")) == 1
    twice = as_owner(api, s).delete(url)
    assert (twice.status_code, twice.json()["code"]) == (404, "reassignment-not-found")
    again = reassign(api, s, task["id"], from_user_id=first, to_user_id=third)
    assert again.status_code == 201, again.text
    give_decision(database, s, task["id"], s.slides[3], "third")
    started = as_owner(api, s).delete(
        f"/api/review-tasks/{task['id']}/reassignments/{again.json()['id']}"
    )
    assert (started.status_code, started.json()["code"]) == (409, "reassignment-started")
