import json
import uuid
from dataclasses import replace
from typing import Any

import pytest
from db_support import OWNER_URL, ApiAs, query, with_database
from test_evaluation_api import scenario
from test_rate_limits import away_from_the_minute_edge
from test_reviewed_layer import Review, review

pytestmark = pytest.mark.db


def links(r: Review) -> str:
    return f"/api/review-tasks/{r.task}/evaluation/links"


def created(api: ApiAs, r: Review) -> dict[str, Any]:
    response = api(r.people["owner"]).post(links(r))
    assert response.status_code == 201, response.text
    return response.json()


def opened(api: ApiAs, token: str) -> Any:
    api.principal = None
    return api.client.get(f"/api/shared-reports/{token}")


def events(database: str, link_id: str) -> list[tuple[Any, ...]]:
    return query(
        with_database(OWNER_URL, database),
        f"SELECT action, actor_kind, details FROM audit_events "
        f"WHERE target_type = 'report-link' AND target_id = '{link_id}' ORDER BY seq",
    )


def test_a_link_shows_the_report_without_slides_or_people(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    link = created(api, r)
    assert link["url"].endswith(f"/shared-reports/{link['token']}")
    assert (link["expired"], link["revoked_at"], link["opened_count"]) == (False, None, 0)
    response = opened(api, link["token"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task_name"]
    report = body["evaluation"]
    full = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/evaluation").json()
    for key in ("classes", "overall", "dice", "reasons", "mean_kappa", "decisions"):
        assert report[key] == full[key]
    assert [(pair["first"], pair["second"]) for pair in report["kappa"]] == [
        ("Reviewer A", "Reviewer B")
    ]
    assert {"task_id", "presets", "display"}.isdisjoint(report)
    assert all("texts" not in item for item in report["opinions"])
    text = response.text
    hidden = [r.task, r.slide, r.result_set, r.project, *(p.user_id for p in r.people.values())]
    assert not [str(value) for value in hidden if str(value) in text]
    [listed] = api(r.people["owner"]).get(links(r)).json()
    assert (listed["id"], listed["opened_count"]) == (link["id"], 1)
    assert listed["last_opened_at"] is not None
    assert "token" not in listed
    logged = events(database, link["id"])
    assert [(action, kind) for action, kind, _ in logged] == [
        ("report-link.created", "member"),
        ("report-link.opened", "system"),
    ]
    assert json.loads(str(logged[1][2])) == {"refused": False, "task_id": str(r.task)}


def test_a_revoked_link_stops_working_and_the_refusal_is_logged(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    link = created(api, r)
    path = f"{links(r)}/{link['id']}"
    assert api(r.people["owner"]).delete(path).status_code == 204
    assert api(r.people["owner"]).delete(path).status_code == 204
    gone = opened(api, link["token"])
    assert (gone.status_code, gone.json()["code"]) == (410, "report-link-gone")
    [listed] = api(r.people["owner"]).get(links(r)).json()
    assert listed["revoked_at"] is not None
    assert listed["opened_count"] == 0
    logged = events(database, link["id"])
    assert [action for action, _, _ in logged] == [
        "report-link.created",
        "report-link.revoked",
        "report-link.opened",
    ]
    assert json.loads(str(logged[2][2]))["refused"] is True
    unknown = api(r.people["owner"]).delete(f"{links(r)}/{uuid.uuid4()}")
    assert unknown.status_code == 404


def test_an_expired_or_unknown_link_shows_nothing(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    link = created(api, r)
    query(
        with_database(OWNER_URL, database),
        f"UPDATE report_links SET expires_at = now() - interval '1 second' "
        f"WHERE id = '{link['id']}'",
    )
    assert opened(api, link["token"]).status_code == 410
    [listed] = api(r.people["owner"]).get(links(r)).json()
    assert listed["expired"] is True
    missing = opened(api, "not-a-real-token")
    assert (missing.status_code, missing.json()["code"]) == (404, "not-found")


def test_only_the_project_owner_manages_links(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    link = created(api, r)
    for who in ("first", "viewer"):
        assert api(r.people[who]).post(links(r)).status_code == 403
        assert api(r.people[who]).get(links(r)).status_code == 403
        assert api(r.people[who]).delete(f"{links(r)}/{link['id']}").status_code == 403
    other = review(api, database)
    assert api(other.people["owner"]).post(links(r)).status_code == 404
    assert api(other.people["owner"]).get(links(r)).status_code == 404
    assert api(other.people["owner"]).delete(f"{links(r)}/{link['id']}").status_code == 404
    elsewhere = f"/api/review-tasks/{other.task}/evaluation/links/{link['id']}"
    assert api(other.people["owner"]).delete(elsewhere).status_code == 404
    assert opened(api, link["token"]).status_code == 200


def test_each_link_is_rate_limited_on_its_own(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    first, second = created(api, r), created(api, r)
    state = api.app.state.auth
    api.app.state.auth = replace(state, limits=replace(state.limits, report_link_per_minute=2))
    away_from_the_minute_edge()
    codes = [opened(api, first["token"]).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    refused = opened(api, first["token"])
    assert refused.json()["code"] == "rate-limited"
    assert 1 <= int(refused.headers["retry-after"]) <= 60
    assert opened(api, second["token"]).status_code == 200
    assert opened(api, "unknown-token").status_code == 404
    opened_events = [row for row in events(database, first["id"]) if row[0] == "report-link.opened"]
    assert len(opened_events) == 2


def test_a_link_to_a_deleted_project_is_gone(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    link = created(api, r)
    query(
        with_database(OWNER_URL, database),
        f"UPDATE projects SET deleted_at = now() WHERE id = '{r.project}'",
    )
    gone = opened(api, link["token"])
    assert (gone.status_code, gone.json()["code"]) == (410, "report-link-gone")
    assert "project_name" not in gone.text
    logged = events(database, link["id"])
    assert json.loads(str(logged[-1][2]))["refused"] is True
