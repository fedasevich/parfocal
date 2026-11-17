from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

TEAM = "/api/me/team"
WORKLOAD = "/api/tenant/workload"


def ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def reviewers_of(task: dict[str, Any], r: Review) -> dict[str, dict[str, Any]]:
    names = {str(person.user_id): label for label, person in r.people.items()}
    return {names[item["user_id"]]: item for item in task["reviewers"]}


def test_the_owner_sees_each_reviewers_progress_from_stored_work(api: ApiAs, database: str) -> None:
    r = review(api, database)
    fresh = ok(api(r.people["owner"]).get(TEAM))
    assert fresh["done"] == []
    [task] = fresh["open"]
    assert (task["id"], task["slides"], task["split"]) == (str(r.task), 1, "all")
    assert task["code"].startswith("RT")
    assert task["project"]["id"] == str(r.project)
    assert task["due_on"] == task["sent_on"]
    assert task["signed_on"] is None
    before = reviewers_of(task, r)
    assert set(before) == {"first", "second"}
    assert {item["status"] for item in before.values()} == {"not-started"}
    assert all(item["minutes_left"] is None for item in before.values())
    owner(
        database,
        "UPDATE review_assignments SET submitted_at = now() "
        f"WHERE task_id = '{r.task}' AND user_id = '{r.people['first'].user_id}'",
    )
    owner(
        database,
        "UPDATE memberships SET availability = 'away', "
        "available_again_at = now() + interval '3 days' "
        f"WHERE user_id = '{r.people['second'].user_id}'",
    )
    owner(
        database,
        "INSERT INTO task_nudges (tenant_id, task_id, user_id) VALUES "
        f"('{r.people['owner'].tenant_id}', '{r.task}', '{r.people['second'].user_id}')",
    )
    after = reviewers_of(ok(api(r.people["owner"]).get(TEAM))["open"][0], r)
    assert (after["first"]["status"], after["first"]["slides_done"]) == ("done", 1)
    assert after["first"]["minutes_left"] == 0
    assert after["second"]["status"] == "away"
    assert after["second"]["away_until"] is not None
    assert after["second"]["nudged_at"] is not None
    assert after["first"]["nudged_at"] is None
    assert ok(api(r.people["first"]).get(TEAM)) | {"as_of": None} == {
        "as_of": None,
        "open": [],
        "done": [],
    }


def test_signed_tasks_move_to_done_and_leave_the_open_workload(api: ApiAs, database: str) -> None:
    r = review(api, database)
    load = {
        item["user_id"]: item["open_tasks"] for item in ok(api(r.people["owner"]).get(WORKLOAD))
    }
    assert load == {str(person.user_id): 0 for person in r.people.values()} | {
        str(r.people["first"].user_id): 1,
        str(r.people["second"].user_id): 1,
    }
    owner(database, f"UPDATE review_tasks SET signed_off_at = now() WHERE id = '{r.task}'")
    team = ok(api(r.people["owner"]).get(TEAM))
    assert team["open"] == []
    assert [task["id"] for task in team["done"]] == [str(r.task)]
    assert team["done"][0]["signed_on"] is not None
    after = ok(api(r.people["owner"]).get(WORKLOAD))
    assert {item["open_tasks"] for item in after} == {0}
