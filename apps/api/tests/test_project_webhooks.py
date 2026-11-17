import asyncio
import json
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, api_settings, with_database
from fastapi.testclient import TestClient
from link_support import Site, serving
from sqlalchemy.ext.asyncio import create_async_engine
from test_review_tasks import Study, add_set, create, insert_id, study
from upload_support import single
from workspace_support import (
    join_project,
    make_case,
    make_project,
    make_slide,
    make_workspace,
    owner,
)

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.project_webhooks import Check, signature_check, signature_of
from parfocal_api.tables import Role
from parfocal_api.webhook_tasks import attach_waiting_tasks
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

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
        "WHERE action IN ('webhook.called', 'webhook.rejected') "
        f"AND tenant_id = '{team.tenant_id}'",
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
    rejected = value(
        database, "SELECT count(*) FROM audit_events WHERE action = 'webhook.rejected'"
    )
    assert rejected == 3
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


@pytest.mark.parametrize("timestamp", ["²", "9" * 5000, "-5", " 17"])
def test_an_odd_timestamp_counts_as_missing(timestamp: str) -> None:
    body = b"{}"
    signature = signature_of("secret", timestamp, body)
    assert signature_check(["secret"], timestamp, signature, body, time.time()) is Check.MISSING


def test_a_signature_checks_only_inside_the_clock_skew() -> None:
    body = b"{}"
    now = 1_800_000_000
    for sent, expected in ((now - 300, Check.VALID), (now + 301, Check.STALE)):
        timestamp = str(sent)
        signature = signature_of("secret", timestamp, body)
        assert signature_check(["old", "secret"], timestamp, signature, body, now) is expected


def test_an_archived_project_or_a_deleted_case_takes_no_slides(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    owner(database, f"UPDATE cases SET deleted_at = now() WHERE id = '{team.case}'")
    deleted_case = call(hooked, hook, body_of(site, team))
    assert deleted_case.json()["code"] == "webhook-case-not-found"
    owner(database, f"UPDATE projects SET archived_at = now() WHERE id = '{team.project}'")
    archived = call(hooked, hook, body_of(site, team))
    assert archived.status_code == 404
    assert archived.json()["code"] == "webhook-project-closed"
    assert uploads_of(database, team) == []


def test_a_slide_already_in_the_case_is_left_out_with_its_results(
    hooked: ApiAs, team: Team, site: Site, database: str
) -> None:
    hook = new_secret(hooked, team)
    make_slide(database, team.tenant_id, team.project, "scan", team.case)
    answer = call(hooked, hook, body_of(site, team)).json()
    assert [(link["kind"], link["outcome"]) for link in answer["links"]] == [
        ("slide", "refused"),
        ("result", "refused"),
    ]
    assert "already in the case" in answer["links"][0]["message"]
    assert uploads_of(database, team) == []


def ingest_finished(
    database: str, s: Study, upload_id: str, slide_id: uuid.UUID, set_id: uuid.UUID | None
) -> None:
    async def go() -> None:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=s.tenant_id)
            ) as connection:
                await attach_waiting_tasks(connection, uuid.UUID(upload_id), slide_id, set_id)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def ingested(database: str, s: Study, upload_id: str) -> uuid.UUID:
    return insert_id(
        database,
        "INSERT INTO slides (tenant_id, project_id, case_id, label, upload_id, original_key) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{s.case}', 'webhook-scan', '{upload_id}', "
        f"'t/{s.tenant_id}/slides/{upload_id}') RETURNING id",
    )


def task_slides(database: str, task_id: str) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT s.slide_id::text, s.result_set_id::text, count(a.user_id) "
        "FROM review_task_slides s LEFT JOIN review_assignments a "
        "ON a.task_id = s.task_id AND a.slide_id = s.slide_id "
        f"WHERE s.task_id = '{task_id}' GROUP BY s.slide_id, s.result_set_id, s.position "
        "ORDER BY s.position",
    )


def test_a_named_review_task_takes_the_slide_once_its_result_set_is_imported(
    hooked: ApiAs, site: Site, database: str
) -> None:
    s = study(database)
    task = create(hooked, s).json()
    response = hooked(s.people["admin"]).post(f"/api/projects/{s.project}/webhook/secret")
    hook = response.json()
    team = Team(s.tenant_id, s.people["admin"], s.people["first"], s.project, s.case)
    answer = call(hooked, hook, body_of(site, team, task_id=task["id"])).json()
    assert answer["task"]["outcome"] == "waiting"
    slide_upload = answer["links"][0]["upload_id"]
    before = len(task_slides(database, task["id"]))
    slide_id = ingested(database, s, slide_upload)
    ingest_finished(database, s, slide_upload, slide_id, None)
    assert len(task_slides(database, task["id"])) == before
    set_id = add_set(database, s.tenant_id, s.project, slide_id, "Pipeline", "ready")
    for _ in range(2):
        ingest_finished(database, s, slide_upload, slide_id, set_id)
    added = task_slides(database, task["id"])
    assert len(added) == before + 1
    assert added[-1] == (str(slide_id), str(set_id), 3)
    attached = owner(
        database,
        "SELECT count(*) FROM audit_events WHERE action = 'webhook.task-attached' "
        f"AND tenant_id = '{s.tenant_id}'",
    )
    assert attached[0][0] == 1


def test_a_review_task_without_a_result_file_is_not_attached(
    hooked: ApiAs, site: Site, database: str
) -> None:
    s = study(database)
    task = create(hooked, s).json()
    hook = hooked(s.people["admin"]).post(f"/api/projects/{s.project}/webhook/secret").json()
    team = Team(s.tenant_id, s.people["admin"], s.people["first"], s.project, s.case)
    answer = call(hooked, hook, body_of(site, team, task_id=task["id"], results=[])).json()
    assert answer["task"]["outcome"] == "not-attached"
    assert answer["task"]["message"] == "A review task needs a result file with the slide."
    waiting = owner(
        database,
        "SELECT count(*) FROM webhook_calls "
        f"WHERE task_id IS NOT NULL AND tenant_id = '{s.tenant_id}'",
    )
    assert waiting[0][0] == 0
