import uuid
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from db_support import ApiAs
from idp_support import Browser, signed_in_browser

from parfocal_api.principals import MemberPrincipal, ServicePrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


def shift(browser: Browser, column: str, minutes: int) -> None:
    browser.sql(
        f"UPDATE sessions SET {column} = now() - interval '{minutes} minutes' "
        f"WHERE subject = '{browser.idp.subject}'"
    )


def session_code(browser: Browser) -> tuple[int, str | None]:
    response = browser.session()
    body = response.json()
    return response.status_code, body.get("code")


def member_of_new_workspace(browser: Browser, **policy: int) -> str:
    slug = f"ses-{uuid.uuid4().hex[:10]}"
    tenant_id = str(
        browser.sql(
            f"WITH organisation AS (INSERT INTO organisations (slug, name) VALUES ('{slug}', "
            f"'{slug}') RETURNING id) INSERT INTO tenants (organisation_id, slug, name, kind, "
            f"region, plan) SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' "
            "FROM organisation RETURNING id"
        )[0][0]
    )
    if policy:
        values = {"idle_lock_minutes": 15, "session_hours": 12} | policy
        browser.sql(
            "INSERT INTO session_policies (tenant_id, idle_lock_minutes, session_hours) "
            f"VALUES ('{tenant_id}', {values['idle_lock_minutes']}, {values['session_hours']})"
        )
    browser.sql(
        "INSERT INTO memberships (tenant_id, user_id, role) SELECT "
        f"'{tenant_id}', id, 'lead' FROM users WHERE subject = '{browser.idp.subject}'"
    )
    assert browser.client.put("/api/me/workspace", json={"tenant_id": tenant_id}).status_code == 200
    return tenant_id


@pytest.fixture
def second_device(browser: Browser, database: str) -> Iterator[Browser]:
    with signed_in_browser(database) as other:
        other.idp.subject = browser.idp.subject
        yield other


def test_an_idle_session_locks(browser: Browser) -> None:
    browser.login()
    shift(browser, "active_at", 16)
    assert session_code(browser) == (401, "session-locked")
    assert browser.client.post("/api/auth/activity").status_code == 401


def test_activity_keeps_the_session_open(browser: Browser) -> None:
    browser.login()
    shift(browser, "active_at", 14)
    assert browser.client.post("/api/auth/activity").status_code == 204
    shift(browser, "active_at", 0)
    assert session_code(browser)[0] == 200


def test_background_calls_do_not_count_as_activity(browser: Browser) -> None:
    browser.login()
    shift(browser, "active_at", 10)
    shift(browser, "last_seen_at", 10)
    for _ in range(3):
        assert browser.client.get("/api/me").status_code == 200
    stale = browser.sql(
        "SELECT active_at < now() - interval '9 minutes' FROM sessions "
        f"WHERE subject = '{browser.idp.subject}'"
    )
    assert stale == [(True,)]


def test_the_workspace_sets_the_idle_time(browser: Browser) -> None:
    browser.login()
    member_of_new_workspace(browser, idle_lock_minutes=5)
    shift(browser, "active_at", 4)
    assert session_code(browser)[0] == 200
    shift(browser, "active_at", 6)
    assert session_code(browser) == (401, "session-locked")


def test_unlocking_asks_for_the_password_and_replaces_the_locked_session(
    browser: Browser,
) -> None:
    browser.login()
    shift(browser, "active_at", 30)
    started = browser.client.get(
        "/api/auth/login", params={"return_to": "/cases/S26-0009?x=1", "reauth": "true"}
    )
    assert parse_qs(urlparse(started.headers["location"]).query)["prompt"] == ["login"]
    plain = browser.client.get("/api/auth/login", params={"return_to": "/"})
    assert "prompt" not in parse_qs(urlparse(plain.headers["location"]).query)
    hop = browser.login("/cases/S26-0009?x=1")
    assert "/cases/S26-0009?x=1" in hop.text
    assert session_code(browser)[0] == 200
    count = browser.sql(f"SELECT count(*) FROM sessions WHERE subject = '{browser.idp.subject}'")
    assert count == [(1,)]


def test_the_workspace_sets_the_session_lifetime(browser: Browser) -> None:
    browser.login()
    member_of_new_workspace(browser, session_hours=1)
    shift(browser, "created_at", 61)
    assert session_code(browser) == (401, "unauthenticated")
    count = browser.sql(f"SELECT count(*) FROM sessions WHERE subject = '{browser.idp.subject}'")
    assert count == [(0,)]


def test_a_person_sees_their_sessions_and_ends_the_others(
    browser: Browser, second_device: Browser
) -> None:
    browser.login()
    second_device.login()
    listed = browser.client.get("/api/auth/sessions").json()
    assert sorted(item["current"] for item in listed) == [False, True]
    assert {item["user_agent"] for item in listed} == {"testclient"}
    ended = browser.client.post("/api/auth/sessions/end-others")
    assert ended.json() == {"ended": 1}
    assert session_code(second_device)[0] == 401
    assert session_code(browser)[0] == 200
    assert len(browser.idp.revoked) == 1
    audited = browser.sql(
        "SELECT details FROM audit_events JOIN audit_people ON audit_people.id = actor_id "
        f"WHERE subject = '{browser.idp.subject}' AND action = 'user.sessions-ended'"
    )
    assert audited == [('{"count":1}',)]


def test_one_session_is_ended_by_its_id(browser: Browser, second_device: Browser) -> None:
    browser.login()
    second_device.login()
    other = next(
        item["id"]
        for item in browser.client.get("/api/auth/sessions").json()
        if not item["current"]
    )
    assert browser.client.delete(f"/api/auth/sessions/{other}").status_code == 204
    assert session_code(second_device)[0] == 401
    assert browser.client.delete(f"/api/auth/sessions/{other}").status_code == 404
    assert browser.client.delete(f"/api/auth/sessions/{uuid.uuid4()}").status_code == 404


def test_nobody_ends_someone_elses_session(browser: Browser, database: str) -> None:
    browser.login()
    with signed_in_browser(database) as stranger:
        stranger.login()
        theirs = stranger.client.get("/api/auth/sessions").json()[0]["id"]
        assert browser.client.delete(f"/api/auth/sessions/{theirs}").status_code == 404
        assert session_code(stranger)[0] == 200


def test_the_lead_sets_the_session_policy(api: ApiAs, browser: Browser) -> None:
    browser.login()
    tenant_id = member_of_new_workspace(browser)
    user_id = uuid.UUID(
        str(browser.sql(f"SELECT id FROM users WHERE subject = '{browser.idp.subject}'")[0][0])
    )
    lead = MemberPrincipal(browser.idp.subject, uuid.UUID(tenant_id), user_id, Role.LEAD)
    assert api(lead).get("/api/tenant/session-policy").json() == {
        "tenant_id": tenant_id,
        "idle_lock_minutes": 15,
        "session_hours": 12,
    }
    change = {"idle_lock_minutes": 30, "session_hours": 8}
    assert api(lead).put("/api/tenant/session-policy", json=change).status_code == 200
    assert api(lead).get("/api/tenant/session-policy").json()["idle_lock_minutes"] == 30
    for invalid in (
        {"idle_lock_minutes": 0, "session_hours": 8},
        {"idle_lock_minutes": 5, "session_hours": 25},
    ):
        assert api(lead).put("/api/tenant/session-policy", json=invalid).status_code == 422
    actions = browser.sql(
        f"SELECT action FROM audit_events WHERE tenant_id = '{tenant_id}' ORDER BY seq"
    )
    assert actions == [("tenant.session-policy-changed",)]


def test_services_have_no_sessions(api: ApiAs) -> None:
    service = ServicePrincipal(uuid.uuid4(), uuid.uuid4(), frozenset({"see-team"}))
    assert api(service).get("/api/auth/sessions").status_code == 403
