import uuid
from collections.abc import Iterator
from urllib.parse import urlparse

import pytest
from db_support import OWNER_URL, ApiAs, api_settings, query, with_database
from fastapi.testclient import TestClient
from idp_support import ORIGIN
from test_showcase import EmptyStore, MemoryResults
from workspace_support import make_workspace, owner

from parfocal_api.app import create_app
from parfocal_api.auth import SESSION_COOKIE, digest
from parfocal_api.principals import MemberPrincipal
from parfocal_api.study_links import JOIN_PATH
from parfocal_api.study_participants import InProcessStudySeeder
from parfocal_api.study_projects import seat_subject
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


def owner_url(database: str) -> str:
    return with_database(OWNER_URL, database)


@pytest.fixture
def moderator(api: ApiAs, database: str) -> MemberPrincipal:
    api.app.state.study_seeder = InProcessStudySeeder(
        owner_url(database),
        EmptyStore(),  # type: ignore[arg-type]
        MemoryResults(),
    )
    made = make_workspace(
        database, {"admin": Role.RESEARCHER, "reviewer": Role.REVIEWER}, admins={"admin"}
    ).people
    admin = made["admin"]
    owner(database, f"UPDATE users SET email = 'mod@study.invalid' WHERE id = '{admin.user_id}'")
    return admin


@pytest.fixture
def browser(database: str) -> Iterator[TestClient]:
    app = create_app(api_settings(database))
    with TestClient(
        app, base_url="https://testserver", follow_redirects=False, headers={"origin": ORIGIN}
    ) as client:
        yield client


def fresh_browser(database: str) -> TestClient:
    return TestClient(
        create_app(api_settings(database)),
        base_url="https://testserver",
        follow_redirects=False,
        headers={"origin": ORIGIN},
    )


def token_of(url: str) -> str:
    parsed = urlparse(url)
    assert parsed.path == JOIN_PATH
    assert parsed.query == ""
    return parsed.fragment


def make_link(api: ApiAs, moderator: MemberPrincipal, code: str) -> dict[str, str]:
    made = api(moderator).post(f"/api/tenant/study-participants/{code}/link")
    assert made.status_code == 200, made.text
    return made.json()


def redeem(client: TestClient, token: str) -> int:
    return client.post("/api/study-links/redeem", json={"token": token}).status_code


def test_a_link_signs_a_fresh_browser_into_the_participant_seat_once(
    api: ApiAs, database: str, moderator: MemberPrincipal, browser: TestClient
) -> None:
    link = make_link(api, moderator, "p-l1")
    assert link["code"] == "P-L1"
    token = token_of(link["url"])
    stored = query(
        owner_url(database),
        f"SELECT token_hash, redeemed_at FROM study_links WHERE participant = '{link['code']}'",
    )
    assert stored == [(digest(token), None)]
    [(hashed, _)] = stored
    assert isinstance(hashed, bytes)
    assert token.encode() not in hashed

    joined = browser.post("/api/study-links/redeem", json={"token": token})
    assert joined.status_code == 200, joined.text
    assert joined.json() == {"code": "P-L1"}
    assert joined.headers["cache-control"] == "no-store"
    assert SESSION_COOKIE in joined.cookies

    me = browser.get("/api/me")
    assert me.status_code == 200, me.text
    assert me.json()["active_tenant_id"] == link["workspace_id"]
    projects = browser.get("/api/projects")
    assert projects.status_code == 200, projects.text
    assert [row["id"] for row in projects.json()] == [link["project_id"]]

    again = fresh_browser(database)
    with again:
        assert redeem(again, token) == 410
        assert again.get("/api/me").status_code == 401


def test_a_link_past_its_day_or_replaced_or_unknown_is_refused(
    api: ApiAs, database: str, moderator: MemberPrincipal, browser: TestClient
) -> None:
    expired = token_of(make_link(api, moderator, "P-L2")["url"])
    owner(
        database,
        "UPDATE study_links SET expires_at = now() - interval '1 second' "
        f"WHERE token_hash = '\\x{digest(expired).hex()}'",
    )
    assert redeem(browser, expired) == 410

    first = token_of(make_link(api, moderator, "P-L3")["url"])
    second = token_of(make_link(api, moderator, "P-L3")["url"])
    assert redeem(browser, first) == 410
    assert redeem(browser, "x" * 43) == 410
    assert redeem(browser, second) == 200

    [(lifetime,)] = query(
        owner_url(database),
        "SELECT expires_at - created_at FROM study_links "
        f"WHERE token_hash = '\\x{digest(second).hex()}'",
    )
    assert str(lifetime) == "1 day, 0:00:00"


def test_the_participant_seat_sees_only_its_project_and_no_results(
    api: ApiAs, database: str, moderator: MemberPrincipal, browser: TestClient
) -> None:
    other = make_link(api, moderator, "P-L5")
    mine = make_link(api, moderator, "P-L4")
    assert redeem(browser, token_of(mine["url"])) == 200

    assert browser.get(f"/api/projects/{other['project_id']}").status_code == 404
    assert browser.get(f"/api/projects/{mine['project_id']}").status_code == 200
    refused = browser.get("/api/tenant/study-sessions")
    assert refused.status_code == 403
    assert refused.json()["code"] == "study-seat-refused"
    assert browser.get("/api/tenant/study-sessions/any/trace").status_code == 403
    assert browser.get("/api/tenant/study-links").status_code == 403
    assert browser.post("/api/tenant/study-participants/P-L9/link").status_code == 403
    [(admin_rights,)] = query(
        owner_url(database),
        "SELECT m.admin_rights FROM memberships m JOIN users u ON u.id = m.user_id "
        f"WHERE u.subject = '{seat_subject('P-L4')}'",
    )
    assert admin_rights is False


def test_the_moderator_lists_links_and_removing_ends_the_participant_session(
    api: ApiAs, database: str, moderator: MemberPrincipal, browser: TestClient
) -> None:
    link = make_link(api, moderator, "P-L6")
    in_study = MemberPrincipal(
        moderator.subject,
        uuid.UUID(link["workspace_id"]),
        moderator.user_id,
        Role.RESEARCHER,
        True,
    )
    listed = api(in_study).get("/api/tenant/study-links")
    assert listed.status_code == 200, listed.text
    assert [row["state"] for row in listed.json()["links"] if row["code"] == "P-L6"] == ["waiting"]

    assert redeem(browser, token_of(link["url"])) == 200
    rows = api(in_study).get("/api/tenant/study-links").json()["links"]
    assert [row["state"] for row in rows if row["code"] == "P-L6"] == ["joined"]

    assert api(in_study).delete("/api/tenant/study-participants/P-L6").status_code == 200
    assert browser.get("/api/me").status_code == 401


def seat_role(database: str, code: str) -> object:
    [(role,)] = query(
        owner_url(database),
        "SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id "
        f"WHERE u.subject = '{seat_subject(code)}'",
    )
    return role


def test_a_seat_seated_by_a_link_holds_the_study_participant_role_and_no_more(
    api: ApiAs, database: str, moderator: MemberPrincipal, browser: TestClient
) -> None:
    other = make_link(api, moderator, "P-R2")
    mine = make_link(api, moderator, "P-R1")
    assert redeem(browser, token_of(mine["url"])) == 200

    me = browser.get("/api/me").json()
    [seat] = [row for row in me["workspaces"] if row["tenant_id"] == mine["workspace_id"]]
    assert (seat["role"], seat["admin_rights"]) == ("study-participant", False)
    assert seat_role(database, "P-R1") == "study-participant"

    made = browser.post("/api/projects", json={"name": "Escape"})
    assert made.status_code == 403, made.text
    assert made.json()["code"] == "study-participant-refused"
    assert browser.delete(f"/api/projects/{mine['project_id']}").status_code == 403

    listed = browser.get("/api/projects")
    assert [row["id"] for row in listed.json()] == [mine["project_id"]]
    assert browser.get(f"/api/projects/{other['project_id']}").status_code == 404
    emergency = browser.post(
        f"/api/projects/{other['project_id']}/emergency-access",
        json={"reason": "Let me in please"},
    )
    assert emergency.status_code == 403

    assert browser.get("/api/tenant/study-links").status_code == 403
    assert browser.post("/api/tenant/study-participants/P-R9/link").status_code == 403
    assert browser.get("/api/tenant/study-sessions").status_code == 403

    for path, body in (
        ("/api/me/workspaces", {"name": "My own lab"}),
        ("/api/auth/passkeys/registration", None),
        ("/api/invitations/accept", {"token": "x" * 43}),
    ):
        refused = browser.post(path, json=body)
        assert refused.status_code == 403, (path, refused.text)
        assert refused.json()["code"] == "study-participant-refused"


def test_preparing_again_turns_an_older_researcher_seat_into_a_study_participant(
    api: ApiAs, database: str, moderator: MemberPrincipal
) -> None:
    make_link(api, moderator, "P-R3")
    owner(
        database,
        "UPDATE memberships SET role = 'researcher' WHERE user_id = "
        f"(SELECT id FROM users WHERE subject = '{seat_subject('P-R3')}')",
    )
    make_link(api, moderator, "P-R3")
    assert seat_role(database, "P-R3") == "study-participant"
