import uuid
from typing import Any

import pytest
from db_support import ApiAs
from idp_support import Browser
from test_invitations import accept, fresh_email, invitee, outbox
from test_review_tasks import Study, create, study
from workspace_support import owner

pytestmark = pytest.mark.db


def task_of(api: ApiAs, s: Study) -> dict[str, Any]:
    response = create(api, s)
    assert response.status_code == 201, response.text
    return response.json()


def invite_to(api: ApiAs, s: Study, task_id: str, email: str, who: str = "owner") -> Any:
    return api(s.people[who]).post(
        f"/api/review-tasks/{task_id}/invitations", json={"email": email}
    )


def token_of(api: ApiAs) -> str:
    return outbox(api).sent[-1].link.rsplit("/", 1)[1]


def trail(api: ApiAs, s: Study) -> list[str]:
    events = api(s.people["admin"]).get("/api/tenant/audit-events").json()
    return [event["action"] for event in events]


def test_the_email_names_who_asked_the_project_the_work_and_the_due_date(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    task = task_of(api, s)
    email = fresh_email()
    response = invite_to(api, s, task["id"], email.upper())
    assert response.status_code == 201, response.text
    assert (response.json()["email"], response.json()["role"]) == (email, "reviewer")
    assert response.json()["task_id"] == task["id"]
    project_name = str(owner(database, f"SELECT name FROM projects WHERE id = '{s.project}'")[0][0])
    message = outbox(api).sent[-1]
    assert (message.to, message.template) == (email, "task-invitation")
    assert message.link.startswith("http://localhost:5173/invitations/")
    for shown in ("owner", project_name, "Sentinel nodes round 1", "4 slides", "30 November 2026"):
        assert shown in message.text, shown
        assert shown not in message.subject, shown
    assert "S26-" not in message.text + message.html + message.subject
    assert "loose-" not in message.text + message.html + message.subject


def test_accepting_joins_the_task_and_lands_on_its_first_slide(
    api: ApiAs, database: str, browser: Browser
) -> None:
    s = study(database)
    task = task_of(api, s)
    email = fresh_email()
    assert invite_to(api, s, task["id"], email).status_code == 201
    joined = accept(invitee(browser, email), token_of(api))
    assert joined.status_code == 200, joined.text
    body = joined.json()
    assert (body["tenant_id"], body["role"]) == (str(s.tenant_id), "reviewer")
    assert body["landing"] == {
        "project_id": str(s.project),
        "task_id": task["id"],
        "slide_id": task["slides"][0]["slide_id"],
    }
    seen = browser.client.get(f"/api/review-tasks/{task['id']}")
    assert seen.status_code == 200, seen.text
    detail = api(s.people["owner"]).get(f"/api/review-tasks/{task['id']}").json()
    assert detail["reviewer_count"] == 4
    assert trail(api, s)[-4:] == [
        "invitation.accepted",
        "member.added",
        "project.member-set",
        "task.reviewer-added",
    ]


def test_a_task_closed_before_acceptance_still_lets_the_person_join(
    api: ApiAs, database: str, browser: Browser
) -> None:
    s = study(database)
    task = task_of(api, s)
    email = fresh_email()
    assert invite_to(api, s, task["id"], email).status_code == 201
    owner(database, f"UPDATE review_tasks SET archived_at = now() WHERE id = '{task['id']}'")
    joined = accept(invitee(browser, email), token_of(api))
    assert joined.status_code == 200, joined.text
    assert joined.json()["landing"] is None
    assert trail(api, s)[-2:] == ["invitation.accepted", "member.added"]


def test_only_project_owners_invite_and_only_new_people(api: ApiAs, database: str) -> None:
    s = study(database)
    task = task_of(api, s)
    for who in ("first", "viewer", "outsider"):
        refused = invite_to(api, s, task["id"], fresh_email(), who)
        assert refused.status_code in {403, 404}, (who, refused.text)
    member = owner(database, f"SELECT subject FROM users WHERE id = '{s.user('viewer')}'")[0][0]
    owner(database, f"UPDATE users SET email = '{member}@example.test' WHERE subject = '{member}'")
    again = invite_to(api, s, task["id"], f"{member}@example.test")
    assert (again.status_code, again.json()["code"]) == (409, "already-a-member")
    unknown = invite_to(api, s, str(uuid.uuid4()), fresh_email())
    assert unknown.status_code == 404
    other = study(database)
    elsewhere = api(other.people["owner"]).post(
        f"/api/review-tasks/{task['id']}/invitations", json={"email": fresh_email()}
    )
    assert elsewhere.status_code == 404


def test_a_signed_off_task_takes_no_invitations(api: ApiAs, database: str) -> None:
    s = study(database)
    task = task_of(api, s)
    owner(database, f"UPDATE review_tasks SET signed_off_at = now() WHERE id = '{task['id']}'")
    refused = invite_to(api, s, task["id"], fresh_email())
    assert refused.status_code == 409, refused.text
