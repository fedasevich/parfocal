import json
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs, api_settings
from fastapi.testclient import TestClient
from link_support import Site, serving
from upload_support import single
from workspace_support import join_project, make_case, make_project, make_workspace

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.project_webhooks import signature_of
from parfocal_api.tables import Role

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SLIDE = "/exports/scan.svs?token=hidden-query-7c1d"
RESULT = "/exports/scan.geojson"


@dataclass(frozen=True)
class Team:
    tenant_id: uuid.UUID
    admin: MemberPrincipal
    reviewer: MemberPrincipal
    project: uuid.UUID
    case: uuid.UUID


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        served.file(SLIDE, b"slide-bytes")
        served.file(RESULT, b'{"type": "FeatureCollection", "features": []}')
        yield served


@pytest.fixture
def hooked(database: str, site: Site) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [site.origin]})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


def parsed(found: Any) -> Any:
    return json.loads(found) if isinstance(found, str) else found


def value(database: str, statement: str) -> Any:
    return single(database, statement)[0]


@pytest.fixture
def team(database: str) -> Team:
    workspace = make_workspace(
        database, {"admin": Role.RESEARCHER, "reviewer": Role.REVIEWER}, admins=("admin",)
    )
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, workspace.people["admin"], "owner")
    case = make_case(database, workspace.tenant_id, project, "Case 7")
    people = workspace.people
    return Team(workspace.tenant_id, people["admin"], people["reviewer"], project, case)


def new_secret(api: ApiAs, team: Team) -> dict[str, Any]:
    response = api(team.admin).post(f"/api/projects/{team.project}/webhook/secret")
    assert response.status_code == 201, response.text
    return response.json()


def body_of(site: Site, team: Team, **change: Any) -> bytes:
    return json.dumps(
        {
            "slide": site.url(SLIDE),
            "results": [site.url(RESULT)],
            "case_id": str(team.case),
            **change,
        }
    ).encode()


def call(
    api: ApiAs,
    hook: dict[str, Any],
    body: bytes,
    secret: str | None = None,
    sent_at: int | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    timestamp = str(sent_at if sent_at is not None else int(time.time()))
    path = hook["url"].split("://", 1)[1].split("/", 1)[1]
    return api.client.post(
        f"/{path}",
        content=body,
        headers={
            "content-type": "application/json",
            "Parfocal-Timestamp": timestamp,
            "Parfocal-Signature": signature_of(secret or hook["secret"], timestamp, body),
            **(headers or {}),
        },
    )


def calls_logged(database: str, team: Team) -> list[dict[str, Any]]:
    found = value(
        database,
        "SELECT coalesce(json_agg(details ORDER BY seq), '[]') FROM audit_events "
        f"WHERE action = 'webhook.called' AND tenant_id = '{team.tenant_id}'",
    )
    return [parsed(item) for item in parsed(found)]


def uploads_of(database: str, team: Team) -> list[tuple[Any, ...]]:
    found = value(
        database,
        "SELECT coalesce(json_agg(json_build_array(kind, case_id, file_name) ORDER BY kind), '[]') "
        f"FROM uploads WHERE project_id = '{team.project}'",
    )
    return [tuple(item) for item in parsed(found)]


def test_only_admins_create_a_secret_and_it_is_shown_once(
    hooked: ApiAs, team: Team, database: str
) -> None:
    refused = hooked(team.reviewer).post(f"/api/projects/{team.project}/webhook/secret")
    assert refused.status_code == 403
    assert hooked(team.admin).get(f"/api/projects/{team.project}/webhook").status_code == 404
    hook = new_secret(hooked, team)
    shown = hooked(team.admin).get(f"/api/projects/{team.project}/webhook").json()
    assert "secret" not in shown
    assert shown["url"] == hook["url"]
    assert shown["has_old_secret"] is False
    stored = value(database, "SELECT encode(secret_ciphertext, 'escape') FROM project_webhooks")
    assert hook["secret"] not in stored


def test_a_signed_call_imports_the_slide_and_results_into_the_case_and_is_logged(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    task = uuid.uuid4()
    response = call(hooked, hook, body_of(site, team))
    assert response.status_code == 202, response.text
    answer = response.json()
    assert answer["case_id"] == str(team.case)
    assert answer["repeated"] is False
    assert answer["task"] is None
    assert [(link["kind"], link["outcome"]) for link in answer["links"]] == [
        ("slide", "started"),
        ("result", "started"),
    ]
    assert "hidden-query" not in response.text
    assert uploads_of(database, team) == [
        ("result", str(team.case), "scan.geojson"),
        ("slide", str(team.case), "scan.svs"),
    ]
    logged = calls_logged(database, team)
    assert logged == [
        {
            "project_id": str(team.project),
            "outcome": "accepted",
            "signature": "valid",
            "idempotency_key": False,
            "started": 2,
            "refused": 0,
        }
    ]
    every = value(database, "SELECT string_agg(details::text, ' ') FROM audit_events")
    assert hook["secret"] not in every
    assert "hidden-query" not in every
    unknown_task = call(hooked, hook, body_of(site, team, task_id=str(task)))
    assert unknown_task.status_code == 404
    assert unknown_task.json()["code"] == "webhook-task-not-found"


def test_a_bad_or_old_signature_is_refused_with_one_answer_and_logged(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    body = body_of(site, team)
    wrong = call(hooked, hook, body, secret="not-the-secret")
    stale = call(hooked, hook, body, sent_at=int(time.time()) - 301)
    unsigned = hooked.client.post(
        f"/api/webhooks/{hook['url'].rsplit('/', 1)[1]}",
        content=body,
        headers={"content-type": "application/json"},
    )
    unknown = hooked.client.post(f"/api/webhooks/{'0' * 32}", content=body)
    for response in (wrong, stale, unsigned, unknown):
        assert response.status_code == 401
        assert response.json()["code"] == "webhook-refused"
    assert wrong.json() == stale.json() == unsigned.json()
    assert [(item["outcome"], item["signature"]) for item in calls_logged(database, team)] == [
        ("refused", "wrong"),
        ("refused", "stale"),
        ("refused", "missing"),
    ]
    assert uploads_of(database, team) == []


def test_tampering_with_the_body_breaks_the_signature(
    hooked: ApiAs, team: Team, site: Site
) -> None:
    hook = new_secret(hooked, team)
    timestamp = str(int(time.time()))
    signed = body_of(site, team)
    response = hooked.client.post(
        f"/api/webhooks/{hook['url'].rsplit('/', 1)[1]}",
        content=body_of(site, team, results=[]),
        headers={
            "Parfocal-Timestamp": timestamp,
            "Parfocal-Signature": signature_of(hook["secret"], timestamp, signed),
        },
    )
    assert response.status_code == 401


def test_the_old_secret_signs_until_it_is_retired(hooked: ApiAs, team: Team, site: Site) -> None:
    first = new_secret(hooked, team)
    second = new_secret(hooked, team)
    assert second["url"] == first["url"]
    assert second["has_old_secret"] is True
    body = body_of(site, team, results=[])
    assert call(hooked, second, body, secret=first["secret"]).status_code == 202
    retired = hooked(team.admin).delete(f"/api/projects/{team.project}/webhook/old-secret")
    assert retired.status_code == 204
    assert call(hooked, second, body, secret=first["secret"]).status_code == 401
    assert call(hooked, second, body).status_code == 202


def test_a_repeated_idempotency_key_answers_the_first_call_and_imports_once(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    body = body_of(site, team)
    first = call(hooked, hook, body, headers={"Idempotency-Key": "run-42"})
    again = call(hooked, hook, body, headers={"Idempotency-Key": "run-42"})
    assert first.status_code == again.status_code == 202
    assert again.json() == {**first.json(), "repeated": True}
    assert len(uploads_of(database, team)) == 2
    assert [item["outcome"] for item in calls_logged(database, team)] == ["accepted", "repeated"]


def test_a_case_outside_the_project_and_a_bad_body_are_refused_and_logged(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    elsewhere = make_project(database, team.tenant_id)
    other_case = make_case(database, team.tenant_id, elsewhere, "Case 8")
    outside = call(hooked, hook, body_of(site, team, case_id=str(other_case)))
    assert outside.status_code == 404
    assert outside.json()["code"] == "webhook-case-not-found"
    broken = call(hooked, hook, b"{not json")
    assert broken.status_code == 400
    assert [item["outcome"] for item in calls_logged(database, team)] == [
        "case-not-found",
        "invalid",
    ]
    assert uploads_of(database, team) == []


def test_a_missing_file_is_refused_per_link(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    body = body_of(site, team, results=[site.url("/exports/missing.geojson")])
    answer = call(hooked, hook, body).json()
    assert [(link["kind"], link["outcome"]) for link in answer["links"]] == [
        ("slide", "started"),
        ("result", "refused"),
    ]
    assert answer["links"][1]["message"]
    assert len(uploads_of(database, team)) == 1
