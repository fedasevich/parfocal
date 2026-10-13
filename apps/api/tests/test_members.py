import uuid
from collections.abc import Iterator

import pytest
from db_support import ApiAs
from idp_support import Browser, signed_in_browser

from parfocal_api.principals import PlatformOperator

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("operator")


def make_tenant(browser: Browser, status: str = "active") -> str:
    slug = f"ws-{uuid.uuid4().hex[:10]}"
    suspended_at = "now()" if status == "suspended" else "NULL"
    rows = browser.sql(
        "WITH organisation AS ("
        f"INSERT INTO organisations (slug, name) VALUES ('{slug}', 'Hospital {slug}') "
        "RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan, status, "
        f"suspended_at) SELECT id, '{slug}', 'Workspace {slug}', 'diagnostic', 'eu', 'pilot', "
        f"'{status}', {suspended_at} FROM organisation RETURNING id"
    )
    return str(rows[0][0])


def user_id_of(browser: Browser) -> str:
    return str(browser.sql(f"SELECT id FROM users WHERE subject = '{browser.idp.subject}'")[0][0])


def join(browser: Browser, tenant_id: str, role: str = "consultant") -> None:
    browser.sql(
        "INSERT INTO memberships (tenant_id, user_id, role) "
        f"VALUES ('{tenant_id}', '{user_id_of(browser)}', '{role}')"
    )


def switch(browser: Browser, tenant_id: str) -> int:
    return browser.client.put("/api/me/workspace", json={"tenant_id": tenant_id}).status_code


def current_tenant(browser: Browser) -> str | None:
    response = browser.client.get("/api/tenant")
    return response.json()["id"] if response.status_code == 200 else None


@pytest.fixture
def second_browser(database: str) -> Iterator[Browser]:
    with signed_in_browser(database) as signed_in:
        yield signed_in


def test_the_first_login_creates_the_user_without_a_workspace(browser: Browser) -> None:
    browser.login()
    me = browser.client.get("/api/me").json()
    assert me["display_name"] == "Test Pathologist"
    assert me["initials"] == "TP"
    assert 0 <= me["avatar_colour"] < 12
    assert me["email"] == "pathologist@example.test"
    assert (me["title"], me["active_tenant_id"], me["workspaces"]) == (None, None, [])
    assert browser.client.get("/api/tenant").status_code == 403


def test_a_member_of_two_tenants_switches_between_them(browser: Browser) -> None:
    browser.login()
    first, second = make_tenant(browser), make_tenant(browser)
    join(browser, first)
    join(browser, second)
    listed = {
        workspace["tenant_id"] for workspace in browser.client.get("/api/me").json()["workspaces"]
    }
    assert listed == {first, second}

    assert switch(browser, first) == 200
    assert current_tenant(browser) == first
    members = browser.client.get("/api/tenant/members").json()
    assert [member["user_id"] for member in members] == [user_id_of(browser)]

    assert switch(browser, second) == 200
    assert current_tenant(browser) == second
    assert browser.client.get("/api/me").json()["active_tenant_id"] == second


def test_the_last_workspace_comes_back_at_the_next_login(browser: Browser) -> None:
    browser.login()
    first, second = make_tenant(browser), make_tenant(browser)
    join(browser, first)
    join(browser, second)
    switch(browser, second)
    browser.client.cookies.clear()
    browser.login()
    assert current_tenant(browser) == second


def test_a_single_membership_is_chosen_at_login(browser: Browser) -> None:
    browser.login()
    only = make_tenant(browser)
    join(browser, only)
    browser.client.cookies.clear()
    browser.login()
    assert current_tenant(browser) == only


def test_switching_to_a_workspace_without_membership_is_refused(browser: Browser) -> None:
    browser.login()
    mine, theirs = make_tenant(browser), make_tenant(browser)
    join(browser, mine)
    switch(browser, mine)
    for target in (theirs, str(uuid.uuid4())):
        response = browser.client.put("/api/me/workspace", json={"tenant_id": target})
        assert response.status_code == 403
        assert response.json()["code"] == "not-a-member"
    assert current_tenant(browser) == mine


def test_switching_to_a_suspended_workspace_is_refused(browser: Browser) -> None:
    browser.login()
    suspended = make_tenant(browser, status="suspended")
    join(browser, suspended)
    response = browser.client.put("/api/me/workspace", json={"tenant_id": suspended})
    assert response.status_code == 403
    assert response.json()["code"] == "tenant-suspended"


def test_losing_the_membership_closes_the_workspace(browser: Browser) -> None:
    browser.login()
    tenant = make_tenant(browser)
    join(browser, tenant)
    switch(browser, tenant)
    browser.sql(f"DELETE FROM memberships WHERE tenant_id = '{tenant}'")
    assert browser.client.get("/api/tenant").status_code == 403
    me = browser.client.get("/api/me").json()
    assert (me["active_tenant_id"], me["workspaces"]) == (None, [])


def test_members_of_one_workspace_see_each_other_but_not_others(
    browser: Browser, second_browser: Browser
) -> None:
    browser.login()
    second_browser.login()
    shared, private = make_tenant(browser), make_tenant(browser)
    join(browser, shared)
    join(second_browser, shared)
    join(second_browser, private)
    switch(browser, shared)
    seen = {member["user_id"] for member in browser.client.get("/api/tenant/members").json()}
    assert seen == {user_id_of(browser), user_id_of(second_browser)}
    workspaces = browser.client.get("/api/me").json()["workspaces"]
    assert [workspace["tenant_id"] for workspace in workspaces] == [shared]


def test_a_user_edits_their_profile(browser: Browser) -> None:
    browser.login()
    response = browser.client.patch(
        "/api/me",
        json={
            "display_name": "Jana Nováková",
            "initials": "JN",
            "avatar_colour": 7,
            "title": "MUDr.",
        },
    )
    assert response.status_code == 200
    me = response.json()
    assert (me["display_name"], me["initials"], me["avatar_colour"], me["title"]) == (
        "Jana Nováková",
        "JN",
        7,
        "MUDr.",
    )
    assert browser.client.patch("/api/me", json={"title": ""}).json()["title"] is None


def test_a_later_login_keeps_the_edited_profile(browser: Browser) -> None:
    browser.login()
    browser.client.patch("/api/me", json={"display_name": "Jana Nováková", "initials": "JN"})
    browser.client.cookies.clear()
    browser.login()
    assert browser.client.get("/api/me").json()["display_name"] == "Jana Nováková"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("initials", "jn"),
        ("initials", "ABCD"),
        ("avatar_colour", 12),
        ("avatar_colour", -1),
        ("title", "x" * 41),
        ("display_name", " "),
    ],
)
def test_invalid_profile_changes_are_refused(browser: Browser, field: str, value: object) -> None:
    browser.login()
    response = browser.client.patch("/api/me", json={field: value})
    assert response.status_code == 422
    assert [error["location"][-1] for error in response.json()["errors"]] == [field]


def test_operators_add_and_list_members(api: ApiAs, browser: Browser) -> None:
    browser.login()
    tenant = make_tenant(browser)
    user = user_id_of(browser)
    path = f"/api/platform/tenants/{tenant}/members"
    added = api(OPERATOR).post(path, json={"user_id": user, "role": "lead"})
    assert added.status_code == 201
    assert (added.json()["user_id"], added.json()["role"]) == (user, "lead")
    again = api(OPERATOR).post(path, json={"user_id": user, "role": "lead"})
    assert (again.status_code, again.json()["code"]) == (409, "already-a-member")
    assert [member["user_id"] for member in api(OPERATOR).get(path).json()] == [user]
    unknown_user = api(OPERATOR).post(path, json={"user_id": str(uuid.uuid4()), "role": "lab"})
    assert unknown_user.status_code == 404
    unknown_tenant = api(OPERATOR).post(
        f"/api/platform/tenants/{uuid.uuid4()}/members", json={"user_id": user, "role": "lab"}
    )
    assert unknown_tenant.status_code == 404
