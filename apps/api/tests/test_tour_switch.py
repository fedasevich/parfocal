import uuid
from collections import Counter
from collections.abc import Iterator

import pytest
from idp_support import Browser, signed_in_browser

from parfocal_api.auth import TOUR_ORIGIN, sealed_tokens
from parfocal_api.oidc import TokenSet

pytestmark = pytest.mark.db

SWITCH = "/api/tour/role-switch"


@pytest.fixture
def tour(database: str) -> Iterator[Browser]:
    with signed_in_browser(database, tour_role_switch=True) as signed_in:
        yield signed_in


def make_tenant(browser: Browser) -> str:
    slug = f"tour-{uuid.uuid4().hex[:10]}"
    rows = browser.sql(
        "WITH organisation AS ("
        f"INSERT INTO organisations (slug, name) VALUES ('{slug}', 'Lab {slug}') "
        "RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        f"SELECT id, '{slug}', 'Workspace {slug}', 'diagnostic', 'eu', 'pilot' "
        "FROM organisation RETURNING id"
    )
    return str(rows[0][0])


def seat_signed_in(browser: Browser, tenant_id: str, *, admin_rights: bool) -> None:
    browser.sql(
        "INSERT INTO memberships (tenant_id, user_id, role, admin_rights) "
        f"SELECT '{tenant_id}', id, 'researcher', {str(admin_rights).lower()} "
        f"FROM users WHERE subject = '{browser.idp.subject}'"
    )
    assert browser.client.put("/api/me/workspace", json={"tenant_id": tenant_id}).status_code == 200


def seat_role_account(browser: Browser, tenant_id: str, email: str) -> str:
    subject = f"seed:{uuid.uuid4().hex[:8]}-{email}"
    browser.sql(
        "WITH person AS ("
        "INSERT INTO users (subject, email, display_name, initials, avatar_colour) "
        f"VALUES ('{subject}', '{email}', 'Reviewer A', 'RA', 3) RETURNING id) "
        "INSERT INTO memberships (tenant_id, user_id, role) "
        f"SELECT '{tenant_id}', id, 'reviewer' FROM person"
    )
    return subject


def admin_in_tour_workspace(browser: Browser) -> str:
    browser.login()
    tenant_id = make_tenant(browser)
    seat_signed_in(browser, tenant_id, admin_rights=True)
    return tenant_id


def audit_actions(browser: Browser) -> Counter[str]:
    rows = browser.sql("SELECT action FROM audit_events WHERE action LIKE 'user.tour-role-%'")
    return Counter(str(row[0]) for row in rows)


def test_an_admin_switches_to_a_role_account_and_back(tour: Browser) -> None:
    tenant_id = admin_in_tour_workspace(tour)
    role_subject = seat_role_account(tour, tenant_id, "role-reviewer-a@parfocal.eu")
    before = audit_actions(tour)

    switched = tour.client.post(SWITCH, json={"account": "reviewer-a"})
    assert switched.status_code == 200, switched.text
    assert switched.json() == {
        "name": "Reviewer A",
        "email": "role-reviewer-a@parfocal.eu",
        "switched": True,
    }
    assert "password" not in switched.text
    session = tour.session().json()
    assert (session["subject"], session["email"]) == (role_subject, "role-reviewer-a@parfocal.eu")
    assert tour.client.get("/api/me").json()["display_name"] == "Reviewer A"

    again = tour.client.post(SWITCH, json={"account": "reviewer-a"})
    assert again.status_code == 403

    back = tour.client.delete(SWITCH)
    assert back.status_code == 200, back.text
    assert back.json()["switched"] is False
    assert tour.session().json()["subject"] == tour.idp.subject
    assert audit_actions(tour) - before == Counter(
        {"user.tour-role-switched": 1, "user.tour-role-returned": 1}
    )


def test_the_switch_is_refused_while_the_server_flag_is_off(browser: Browser) -> None:
    tenant_id = admin_in_tour_workspace(browser)
    seat_role_account(browser, tenant_id, "role-reviewer-a@parfocal.eu")
    response = browser.client.post(SWITCH, json={"account": "reviewer-a"})
    assert (response.status_code, response.json()["code"]) == (404, "tour-switch-off")
    assert browser.client.delete(SWITCH).status_code == 404


def test_a_member_without_admin_rights_cannot_start_the_switch(tour: Browser) -> None:
    tour.login()
    tenant_id = make_tenant(tour)
    seat_signed_in(tour, tenant_id, admin_rights=False)
    seat_role_account(tour, tenant_id, "role-reviewer-a@parfocal.eu")
    assert tour.client.post(SWITCH, json={"account": "reviewer-a"}).status_code == 403
    assert tour.session().json()["subject"] == tour.idp.subject


def test_only_the_six_role_accounts_are_targets(tour: Browser) -> None:
    tenant_id = admin_in_tour_workspace(tour)
    seat_role_account(tour, tenant_id, "someone@parfocal.eu")
    assert tour.client.post(SWITCH, json={"account": "someone"}).status_code == 422
    missing = tour.client.post(SWITCH, json={"account": "reviewer-b"})
    assert (missing.status_code, missing.json()["code"]) == (404, "no-role-account")
    assert tour.session().json()["subject"] == tour.idp.subject


def test_a_role_account_in_another_workspace_is_not_a_target(tour: Browser) -> None:
    admin_in_tour_workspace(tour)
    elsewhere = make_tenant(tour)
    seat_role_account(tour, elsewhere, "role-viewer@parfocal.eu")
    missing = tour.client.post(SWITCH, json={"account": "viewer"})
    assert (missing.status_code, missing.json()["code"]) == (404, "no-role-account")


def test_returning_without_a_tour_origin_is_refused(tour: Browser) -> None:
    admin_in_tour_workspace(tour)
    response = tour.client.delete(SWITCH)
    assert (response.status_code, response.json()["code"]) == (404, "no-tour-origin")
    assert tour.session().json()["subject"] == tour.idp.subject


def test_a_token_refresh_keeps_the_tour_origin_and_the_role_account_name() -> None:
    origin = {"subject": "owner", "name": "Owner", "email": "owner@example.test"}
    earlier = {"name": "Reviewer A", "email": "role-reviewer-a@parfocal.eu", TOUR_ORIGIN: origin}
    renewed = TokenSet(id_token="id", refresh_token="refresh", expires_in=60)
    sealed = sealed_tokens(renewed, {"name": "Owner", "email": "owner@example.test"}, earlier)
    assert sealed[TOUR_ORIGIN] == origin
    assert (sealed["name"], sealed["email"]) == ("Reviewer A", "role-reviewer-a@parfocal.eu")
