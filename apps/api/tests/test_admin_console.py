import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_invitations import fresh_email
from test_review_tasks import study
from test_task_invitations import invite_to, task_of, token_of
from workspace_support import make_project, owner

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


def source_in(database: str, tenant: uuid.UUID, name: str) -> uuid.UUID:
    [[source]] = owner(
        database,
        "INSERT INTO import_sources (tenant_id, name, kind, address) "
        f"VALUES ('{tenant}', '{name}', 'https', 'https://{name}.example.org/') RETURNING id",
    )
    return uuid.UUID(str(source))


def remote_slide(
    database: str, tenant: uuid.UUID, project: uuid.UUID, source: uuid.UUID, failures: int
) -> None:
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, storage, source_id, remote_path, "
        "file_bytes, remote_failures, remote_read_at) "
        f"VALUES ('{tenant}', '{project}', 'remote-{uuid.uuid4().hex[:6]}', 'remote', "
        f"'{source}', 'a/b.svs', 900000000000, {failures}, now())",
    )


def test_space_per_kind_and_per_project_adds_up_to_the_total(api: ApiAs, database: str) -> None:
    s = study(database)
    second = make_project(database, s.tenant_id, "de-identified")
    owner(database, f"UPDATE slides SET file_bytes = 1500000000 WHERE project_id = '{s.project}'")
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, file_bytes) "
        f"VALUES ('{s.tenant_id}', '{second}', 'big', 7000000000)",
    )
    answering = source_in(database, s.tenant_id, "answering")
    gone = source_in(database, s.tenant_id, "gone")
    source_in(database, s.tenant_id, "unused")
    remote_slide(database, s.tenant_id, s.project, answering, 0)
    remote_slide(database, s.tenant_id, second, gone, 5)
    owner(
        database,
        "UPDATE slides SET deleted_at = now() "
        f"WHERE id = (SELECT id FROM slides WHERE project_id = '{s.project}' "
        "AND storage = 'uploaded' LIMIT 1)",
    )

    usage = ok(api(s.people["admin"]).get("/api/tenant/storage"))

    copied = owner(
        database,
        "SELECT sum(file_bytes) FROM slides WHERE storage = 'uploaded' AND deleted_at IS NULL "
        f"AND tenant_id = '{s.tenant_id}'",
    )[0][0]
    assert usage["total_bytes"] == copied
    assert sum(part["bytes"] for part in usage["parts"]) == usage["total_bytes"]
    assert sum(row["bytes"] for row in usage["by_project"]) == usage["total_bytes"]
    assert [part["kind"] for part in usage["parts"]] == ["copied-slides"]
    assert [row["project"]["id"] for row in usage["by_project"]] == [str(second), str(s.project)]
    assert usage["by_project"][0]["bytes"] == 7000000000
    assert usage["in_place_bytes"] == 1800000000000
    assert usage["capacity_tb"] is None
    health = {source["name"]: source for source in usage["sources"]}
    assert health["answering"]["health"] == "answering"
    assert health["answering"]["new_slides"] == "in-place"
    assert health["answering"]["slides_in_place"] == 1
    assert health["answering"]["last_read_at"] is not None
    assert health["gone"]["health"] == "unreachable"
    assert (health["unused"]["health"], health["unused"]["new_slides"]) == ("unused", "copied")
    assert [rule["key"] for rule in usage["rules"]] == ["read-only-keys"]
    overview = ok(api(s.people["admin"]).get("/api/tenant/overview"))
    assert overview["in_place_tb"] == 1.8
    assert api(s.people["first"]).get("/api/tenant/storage").status_code == 403


def test_security_names_the_sign_in_ways(api: ApiAs, database: str) -> None:
    s = study(database)
    security = ok(api(s.people["admin"]).get("/api/tenant/security"))
    sso = next(item for item in security["sign_in"] if item["key"] == "sso")
    assert (sso["on"], sso["locked"]) == (False, True)
    assert security["two_factor"] is None


def test_webhooks_list_each_project_hook_in_and_event_target_out(api: ApiAs, database: str) -> None:
    s = study(database)
    assert ok(api(s.people["admin"]).get("/api/tenant/webhooks")) == []
    [[hook]] = owner(
        database,
        "INSERT INTO project_webhooks (tenant_id, project_id, hook_key, secret_ciphertext) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{uuid.uuid4().hex}', '\\x00') RETURNING id",
    )
    [[target]] = owner(
        database,
        "INSERT INTO event_targets (tenant_id, project_id, address, events, secret_ciphertext, "
        f"paused_at) VALUES ('{s.tenant_id}', '{s.project}', 'https://lab.example.org/in', "
        "ARRAY['task-signed-off', 'review-submitted'], '\\x00', now()) RETURNING id",
    )
    [[event]] = owner(
        database,
        "INSERT INTO event_outbox (tenant_id, project_id, target_id, kind, body) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{target}', 'review-submitted', '{{}}') "
        "RETURNING id",
    )
    owner(
        database,
        "INSERT INTO event_attempts (tenant_id, event_id, outcome, status_code, duration_ms) "
        f"VALUES ('{s.tenant_id}', '{event}', 'status', 500, 40), "
        f"('{s.tenant_id}', '{event}', 'delivered', 200, 30), "
        f"('{s.tenant_id}', '{event}', 'timeout', NULL, 10000)",
    )

    hooks = ok(api(s.people["admin"]).get("/api/tenant/webhooks"))

    incoming, outgoing = hooks
    assert (incoming["id"], incoming["direction"]) == (str(hook), "incoming")
    assert incoming["project"]["id"] == str(s.project)
    assert (incoming["calls_today"], incoming["rejected_today"]) == (0, 0)
    assert (outgoing["id"], outgoing["direction"]) == (str(target), "outgoing")
    assert outgoing["name"] == "lab.example.org"
    assert outgoing["events"] == ["review-submitted", "task-signed-off"]
    assert (outgoing["calls_today"], outgoing["rejected_today"]) == (3, 2)
    assert outgoing["paused"] is True
    overview = ok(api(s.people["admin"]).get("/api/tenant/overview"))
    assert (overview["webhook_calls_today"], overview["webhook_rejected_today"]) == (3, 2)
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
