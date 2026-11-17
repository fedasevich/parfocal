import asyncio
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from db_support import APP_URL, TEST_MASTER_KEYS, ApiAs, api_settings, with_database
from fastapi.testclient import TestClient
from link_support import Served, Site, serving
from submit_support import submitted
from test_decision_styles import answer
from test_reviewed_layer import Review, review
from workspace_support import make_project, make_workspace, owner

from parfocal_api.app import create_app
from parfocal_api.event_delivery import deliver_due, deliver_until_idle, delivery_client
from parfocal_api.event_emit import emit, no_wake, set_waker
from parfocal_api.principals import MemberPrincipal
from parfocal_api.result_sets import finish
from parfocal_api.tables import EventKind, Role
from parfocal_common.db import create_engine, tenant_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.link_fetch import policy_of
from parfocal_common.webhook_signing import signature, signed_headers, verified

EVERY_KIND = [kind.value for kind in EventKind]


@dataclass(frozen=True)
class Wired:
    tenant_id: uuid.UUID
    project: uuid.UUID
    admin: MemberPrincipal
    target: uuid.UUID
    secret: str


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        served.routes["/events"] = Served(200)
        yield served


@pytest.fixture
def linked(database: str, site: Site) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [site.origin]})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


def targets(project: uuid.UUID) -> str:
    return f"/api/projects/{project}/event-targets"


def wire(
    api: ApiAs, database: str, site: Site, tenant_id: uuid.UUID, project: uuid.UUID, admin: Any
) -> Wired:
    owner(database, f"UPDATE memberships SET admin_rights = true WHERE user_id = '{admin.user_id}'")
    admin = replace(admin, admin_rights=True)
    saved = api(admin).post(
        targets(project), json={"address": site.url("/events"), "events": EVERY_KIND}
    )
    assert saved.status_code == 201, saved.text
    found = saved.json()
    return Wired(tenant_id, project, admin, uuid.UUID(found["id"]), found["secret"])


def wired_review(api: ApiAs, database: str, site: Site) -> tuple[Review, Wired]:
    r = review(api, database)
    tenant_id = r.people["owner"].tenant_id
    return r, wire(api, database, site, tenant_id, r.project, r.people["owner"])


def swept(database: str, site: Site, now: datetime) -> list[str]:
    async def go() -> list[str]:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with delivery_client() as http:
                outcomes = await deliver_due(
                    engine,
                    MasterKeyring.from_setting(TEST_MASTER_KEYS),
                    http,
                    policy_of([site.origin]),
                    now,
                )
                return [str(outcome) for outcome in outcomes]
        finally:
            await engine.dispose()

    return asyncio.run(go())


def emitted(database: str, w: Wired, count: int = 1) -> int:
    async def go() -> int:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with tenant_transaction(engine, w.tenant_id) as connection:
                sent = 0
                for number in range(count):
                    sent += await emit(
                        connection,
                        w.tenant_id,
                        w.project,
                        EventKind.REVIEW_SUBMITTED,
                        {"task_id": uuid.UUID(int=number)},
                    )
                return sent
        finally:
            await engine.dispose()

    return asyncio.run(go())


def finished(database: str, tenant_id: uuid.UUID, set_id: uuid.UUID) -> None:
    async def go() -> None:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with tenant_transaction(engine, tenant_id) as connection:
                await finish(connection, set_id)
        finally:
            await engine.dispose()

    asyncio.run(go())


def received(site: Site) -> list[tuple[dict[str, str], bytes]]:
    calls = [request for request in site.requests if request[0] == "POST"]
    return [
        ({name.lower(): value for name, value in headers.items()}, body)
        for (_, _, headers), body in zip(calls, site.bodies, strict=True)
    ]


def proven(secret: str, headers: dict[str, str], body: bytes) -> bool:
    timestamp = headers["parfocal-timestamp"]
    expected = signature(secret, int(timestamp), body)
    return headers["parfocal-signature"] == expected and verified(
        [secret], timestamp, headers["parfocal-signature"], body, float(timestamp)
    )


def soon() -> datetime:
    return datetime.now(UTC) + timedelta(seconds=1)


def test_a_signature_proves_the_secret_the_body_and_a_fresh_time() -> None:
    body = b'{"kind":"review-submitted"}'
    headers = signed_headers("secret-a", 1_800_000_000, body)
    timestamp, given = headers["Parfocal-Timestamp"], headers["Parfocal-Signature"]
    assert given.startswith("v1=")
    assert verified(["secret-a"], timestamp, given, body, 1_800_000_100)
    assert verified(["old", "secret-a"], timestamp, given, body, 1_800_000_000)
    assert not verified(["secret-b"], timestamp, given, body, 1_800_000_000)
    assert not verified(["secret-a"], timestamp, given, body + b" ", 1_800_000_000)
    assert not verified(["secret-a"], timestamp, given, body, 1_800_000_301)
    assert not verified(["secret-a"], None, given, body, 1_800_000_000)


@pytest.mark.db
def test_a_target_keeps_its_secret_and_refuses_plain_http_elsewhere(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER, "lead": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    listed = linked(w.admin).get(targets(project))
    assert listed.status_code == 200, listed.text
    assert [target["id"] for target in listed.json()["targets"]] == [str(w.target)]
    assert w.secret not in listed.text
    stored = owner(database, f"SELECT secret_ciphertext FROM event_targets WHERE id = '{w.target}'")
    assert w.secret.encode() not in bytes(cast("bytes", stored[0][0]))
    refused = linked(w.admin).post(
        targets(project),
        json={"address": "http://pipeline.example.org/events", "events": ["task-signed-off"]},
    )
    assert (refused.status_code, refused.json()["code"]) == (400, "event-target-invalid")
    looking = linked(workspace.people["lead"]).post(
        targets(project), json={"address": site.url("/events"), "events": EVERY_KIND}
    )
    assert looking.status_code == 403


@pytest.mark.db
def test_submissions_and_disagreements_reach_the_pipeline_signed(
    linked: ApiAs, database: str, site: Site
) -> None:
    r, w = wired_review(linked, database, site)
    disagreed = answer(
        linked, r, str(r.task), "T2", {"value": "disagree", "reasons": ["not_class"]}
    )
    assert disagreed.status_code == 200, disagreed.text
    for who in ("first", "second"):
        assert submitted(linked(r.people[who]), r.base).status_code == 200
    assert swept(database, site, soon()) == ["delivered"] * 3
    calls = received(site)
    documents = [json.loads(body) for _, body in calls]
    assert [document["kind"] for document in documents] == [
        "review-submitted",
        "review-submitted",
        "task-disagreements",
    ]
    assert documents[0]["data"] == {"task_id": str(r.task), "slide_id": str(r.slide)}
    assert documents[2]["data"] == {"task_id": str(r.task)}
    assert [document["sequence"] for document in documents] == sorted(
        document["sequence"] for document in documents
    )
    for headers, body in calls:
        assert proven(w.secret, headers, body)
        assert not proven("another-secret", headers, body)
        assert headers["parfocal-event-id"] == json.loads(body)["id"]
        for person in r.people.values():
            assert str(person.user_id).encode() not in body
    assert swept(database, site, soon() + timedelta(days=1)) == []


@pytest.mark.db
def test_a_sign_off_and_a_finished_result_set_reach_the_pipeline(
    linked: ApiAs, database: str, site: Site
) -> None:
    r, w = wired_review(linked, database, site)
    for who in ("first", "second"):
        assert submitted(linked(r.people[who]), r.base).status_code == 200
    signed = linked(r.people["owner"]).post(f"/api/review-tasks/{r.task}/sign-off")
    assert signed.status_code == 200, signed.text
    added = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
                f"VALUES ('{w.tenant_id}', '{r.project}', '{r.slide}', 'Pipeline', 'import') "
                "RETURNING id",
            )[0][0]
        )
    )
    finished(database, w.tenant_id, added)
    assert swept(database, site, soon()) == ["delivered"] * 4
    documents = [json.loads(body) for _, body in received(site)]
    assert [document["kind"] for document in documents] == [
        "review-submitted",
        "review-submitted",
        "task-signed-off",
        "result-set-added",
    ]
    assert documents[2]["data"]["task_id"] == str(r.task)
    assert documents[3]["data"] == {"result_set_id": str(added), "slide_id": str(r.slide)}


@pytest.mark.db
def test_a_failed_call_is_retried_after_a_minute_with_the_same_event_id(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    assert emitted(database, w) == 1
    site.routes["/events"] = Served(500)
    started = soon()
    assert swept(database, site, started) == ["status"]
    assert swept(database, site, started + timedelta(seconds=30)) == []
    site.routes["/events"] = Served(200)
    assert swept(database, site, started + timedelta(seconds=61)) == ["delivered"]
    calls = received(site)
    assert len(calls) == 2
    assert calls[0][0]["parfocal-event-id"] == calls[1][0]["parfocal-event-id"]
    assert calls[0][1] == calls[1][1]
    assert all(proven(w.secret, headers, body) for headers, body in calls)
    log = linked(w.admin).get(f"{targets(project)}/{w.target}/events")
    assert log.status_code == 200, log.text
    [event] = log.json()["events"]
    assert (event["status"], event["attempts"]) == ("delivered", 2)
    assert [(item["outcome"], item["status_code"]) for item in event["log"]] == [
        ("status", 500),
        ("delivered", 200),
    ]


@pytest.mark.db
def test_five_lost_events_pause_the_target_and_open_its_delivery(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    assert emitted(database, w, 5) == 5
    site.routes["/events"] = Served(503)
    moment = soon()
    for _ in range(6):
        assert swept(database, site, moment) == ["status"] * 5
        moment += timedelta(hours=13)
    assert swept(database, site, moment) == []
    listed = linked(w.admin).get(targets(project)).json()["targets"]
    assert listed[0]["paused_at"] is not None
    assert listed[0]["failures_in_row"] == 5
    assert emitted(database, w) == 0
    [(notification,)] = owner(
        database,
        "SELECT id FROM notifications "
        f"WHERE kind = 'integration-down' AND user_id = '{w.admin.user_id}'",
    )
    opened = linked(w.admin).get(f"/api/me/notifications/{notification}/target")
    assert opened.status_code == 200, opened.text
    target = opened.json()
    assert (target["kind"], target["project_id"]) == ("delivery", str(project))
    events = linked(w.admin).get(f"{targets(project)}/{w.target}/events").json()["events"]
    assert {event["status"] for event in events} == {"failed"}
    assert target["delivery_id"] in {event["id"] for event in events}
    again = linked(w.admin).post(
        f"{targets(project)}/{w.target}/events/{target['delivery_id']}/replay"
    )
    assert again.status_code == 200, again.text
    assert again.json()["paused_at"] is None
    twice = linked(w.admin).post(
        f"{targets(project)}/{w.target}/events/{target['delivery_id']}/replay"
    )
    assert (twice.status_code, twice.json()["code"]) == (409, "event-not-failed")
    site.routes["/events"] = Served(200)
    assert swept(database, site, soon()) == ["delivered"]


@pytest.mark.db
def test_an_event_that_happens_while_a_target_is_paused_is_kept_and_can_be_replayed(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    owner(database, f"UPDATE event_targets SET paused_at = now() WHERE id = '{w.target}'")
    assert emitted(database, w) == 0
    assert swept(database, site, soon()) == []
    assert received(site) == []
    events = linked(w.admin).get(f"{targets(project)}/{w.target}/events").json()["events"]
    [kept] = events
    assert (kept["status"], kept["attempts"], kept["log"]) == ("failed", 0, [])
    replayed = linked(w.admin).post(f"{targets(project)}/{w.target}/events/{kept['id']}/replay")
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["paused_at"] is None
    assert swept(database, site, soon()) == ["delivered"]
    [(headers, body)] = received(site)
    assert headers["parfocal-event-id"] == kept["id"]
    assert proven(w.secret, headers, body)


def lingered(database: str, site: Site, start: datetime, linger: timedelta) -> tuple[int, int]:
    clock = [start]

    async def sleep(seconds: float) -> None:
        clock[0] += timedelta(seconds=seconds)

    async def go() -> tuple[int, int]:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with delivery_client() as http:
                count = await deliver_until_idle(
                    engine,
                    MasterKeyring.from_setting(TEST_MASTER_KEYS),
                    http,
                    policy_of([site.origin]),
                    linger,
                    sleep,
                    lambda: clock[0],
                )
                return count, int((clock[0] - start).total_seconds())
        finally:
            await engine.dispose()

    return asyncio.run(go())


@pytest.mark.db
def test_a_run_that_lingers_delivers_the_retry_and_stops_when_nothing_is_due_soon(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    assert emitted(database, w) == 1
    site.routes["/events"] = Served(500)
    start = soon()
    assert lingered(database, site, start, timedelta()) == (1, 0)
    assert len(received(site)) == 1
    site.routes["/events"] = Served(200)
    count, waited = lingered(database, site, start, timedelta(minutes=35))
    assert count == 1
    assert 60 <= waited < 120
    assert len(received(site)) == 2


@pytest.mark.db
def test_a_run_leaves_at_once_when_the_next_retry_is_beyond_the_window(
    linked: ApiAs, database: str, site: Site
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    owner(database, f"UPDATE event_targets SET failures_in_row = 0 WHERE id = '{w.target}'")
    assert emitted(database, w) == 1
    owner(database, "UPDATE event_outbox SET next_attempt_at = now() + interval '3 hours'")
    assert lingered(database, site, soon(), timedelta(minutes=35)) == (0, 10)
    assert received(site) == []


@pytest.mark.db
def test_emitting_wakes_the_sweep_and_a_failed_wake_does_not_fail_the_emit(
    database: str, site: Site, linked: ApiAs
) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    w = wire(linked, database, site, workspace.tenant_id, project, workspace.people["admin"])
    woken: list[int] = []

    async def counting() -> None:
        woken.append(1)

    async def broken() -> None:
        raise RuntimeError("modal is down")

    try:
        set_waker(counting)
        assert emitted(database, w) == 1
        assert woken == [1]
        set_waker(broken)
        assert emitted(database, w) == 1
        owner(database, f"UPDATE event_targets SET paused_at = now() WHERE id = '{w.target}'")
        set_waker(counting)
        assert emitted(database, w) == 0
        assert woken == [1]
    finally:
        set_waker(no_wake)
