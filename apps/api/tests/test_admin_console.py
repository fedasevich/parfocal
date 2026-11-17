from typing import Any

import pytest
from db_support import ApiAs
from test_invitations import fresh_email
from test_review_tasks import study
from test_task_invitations import invite_to, task_of, token_of
from workspace_support import owner

pytestmark = pytest.mark.db


def ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def test_the_overview_counts_people_projects_invites_and_stored_slides(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    owner(database, f"UPDATE slides SET file_bytes = 2000000000 WHERE project_id = '{s.project}'")
    assert invite_to(api, s, task_of(api, s)["id"], fresh_email()).status_code == 201
    overview = ok(api(s.people["admin"]).get("/api/tenant/overview"))
    assert (overview["people"], overview["researchers"], overview["reviewers"]) == (7, 4, 3)
    assert overview["with_admin_rights"] == 1
    assert overview["projects"] == 1
    assert overview["invites_waiting"] == 1
    assert overview["can_sign_out_user_ids"] == []
    assert overview["models"] > 0
    assert overview["stored_tb"] > 0
    assert overview["capacity_tb"] is None
    assert (overview["webhook_calls_today"], overview["webhook_rejected_today"]) == (0, 0)
    assert api(s.people["first"]).get("/api/tenant/overview").status_code == 403


def test_storage_sums_slide_bytes_per_project_and_lists_sources(api: ApiAs, database: str) -> None:
    s = study(database)
    owner(database, f"UPDATE slides SET file_bytes = 1500000000 WHERE project_id = '{s.project}'")
    usage = ok(api(s.people["admin"]).get("/api/tenant/storage"))
    [project] = usage["by_project"]
    assert project["project"]["id"] == str(s.project)
    assert project["gb"] > 0
    assert project["cap_gb"] is None
    assert [part["kind"] for part in usage["parts"]] == ["copied-slides"]
    assert usage["total_tb"] == usage["parts"][0]["tb"]
    assert usage["sources"] == []
    assert [rule["key"] for rule in usage["rules"]] == ["read-only-keys"]


def test_security_names_the_sign_in_ways_and_webhooks_list_nothing_yet(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    security = ok(api(s.people["admin"]).get("/api/tenant/security"))
    sso = next(item for item in security["sign_in"] if item["key"] == "sso")
    assert (sso["on"], sso["locked"]) == (False, True)
    assert security["two_factor"] is None
    assert ok(api(s.people["admin"]).get("/api/tenant/webhooks")) == []
    assert api(s.people["first"]).get("/api/tenant/webhooks").status_code == 403


def test_the_invite_preview_shows_the_task_without_signing_in(api: ApiAs, database: str) -> None:
    s = study(database)
    task = task_of(api, s)
    email = fresh_email()
    assert invite_to(api, s, task["id"], email).status_code == 201
    token = token_of(api)
    preview = ok(api.client.get(f"/api/invitations/{token}/preview"))
    assert (preview["token"], preview["email"]) == (token, email)
    assert preview["workspace"]["id"] == str(s.tenant_id)
    assert preview["project"]["id"] == str(s.project)
    assert preview["task"]["id"] == task["id"]
    assert preview["task"]["slides"] == len(task["slides"])
    assert preview["task"]["first_slide_id"] == task["slides"][0]["slide_id"]
    assert preview["invited_by"]["user_id"] == str(s.people["owner"].user_id)
    missing = api.client.get("/api/invitations/not-a-token/preview")
    assert missing.status_code == 404, missing.text
    owner(database, "UPDATE invitations SET revoked_at = now() WHERE email = " + f"'{email}'")
    assert api.client.get(f"/api/invitations/{token}/preview").status_code == 404
