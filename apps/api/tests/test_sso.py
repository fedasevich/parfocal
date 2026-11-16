import base64
import json
import uuid
from urllib.parse import parse_qs, urlparse

import httpx2
import pytest
from idp_support import Browser

from parfocal_api.sso import GROUPS_KEY, METADATA_CLAIM, RESOURCE_OWNER_CLAIM, groups_of

pytestmark = pytest.mark.db


def make_connection(
    browser: Browser,
    default_role: str | None = "researcher",
    group_roles: dict[str, str] | None = None,
) -> tuple[str, str, str]:
    slug = f"sso-{uuid.uuid4().hex[:10]}"
    organisation = f"org-{slug}"
    domain = f"{slug}.example.test"
    tenant_id = str(
        browser.sql(
            "WITH organisation AS ("
            f"INSERT INTO organisations (slug, name) VALUES ('{slug}', 'Hospital {slug}') "
            "RETURNING id) "
            "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
            f"SELECT id, '{slug}', 'Workspace {slug}', 'research', 'eu', 'pilot' "
            "FROM organisation RETURNING id"
        )[0][0]
    )
    role = f"'{default_role}'" if default_role else "NULL"
    roles = json.dumps(group_roles or {})
    browser.sql(
        "INSERT INTO sso_connections "
        "(tenant_id, idp_organisation_id, idp_id, email_domains, default_role, group_roles) "
        f"VALUES ('{tenant_id}', '{organisation}', 'idp-{slug}', ARRAY['{domain}'], {role}, "
        f"'{roles}'::jsonb)"
    )
    return tenant_id, organisation, domain


def groups_claim(groups: list[str]) -> dict[str, str]:
    encoded = base64.urlsafe_b64encode(json.dumps(groups).encode()).rstrip(b"=").decode()
    return {GROUPS_KEY: encoded}


def sso_login(browser: Browser, domain: str, return_to: str = "/") -> httpx2.Response:
    started = browser.client.get("/api/auth/sso", params={"domain": domain, "return_to": return_to})
    assert started.status_code == 302
    location = started.headers["location"]
    code = browser.idp.authorize(location)
    state = parse_qs(urlparse(location).query)["state"][0]
    return browser.client.get("/api/auth/callback", params={"code": code, "state": state})


def as_sso_user(browser: Browser, organisation: str, email: str, groups: list[str]) -> None:
    browser.idp.claim_overrides = {
        RESOURCE_OWNER_CLAIM: organisation,
        METADATA_CLAIM: groups_claim(groups),
        "email": email,
    }


def membership_of(browser: Browser, tenant_id: str) -> list[tuple[object, ...]]:
    return browser.sql(
        "SELECT m.role, m.admin_rights FROM memberships m JOIN users u ON u.id = m.user_id "
        f"WHERE u.subject = '{browser.idp.subject}' AND m.tenant_id = '{tenant_id}'"
    )


def test_sso_sends_the_browser_straight_to_the_workspace_idp(browser: Browser) -> None:
    _, organisation, domain = make_connection(browser)
    started = browser.client.get("/api/auth/sso", params={"domain": domain.upper()})
    assert started.status_code == 302
    scopes = parse_qs(urlparse(started.headers["location"]).query)["scope"][0].split()
    assert f"urn:zitadel:iam:org:id:{organisation}" in scopes
    assert any(scope.startswith("urn:zitadel:iam:org:idp:id:idp-sso-") for scope in scopes)
    assert "urn:zitadel:iam:user:metadata" in scopes
    assert "openid" in scopes


def test_an_unknown_domain_goes_back_to_sign_in(browser: Browser) -> None:
    started = browser.client.get("/api/auth/sso", params={"domain": "nobody.example.test"})
    assert started.status_code == 302
    assert started.headers["location"] == "/sign-in?sso=none"


def test_the_first_sso_login_makes_a_member_with_the_mapped_role(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(
        browser, default_role="researcher", group_roles={"pathologists": "reviewer"}
    )
    as_sso_user(browser, organisation, f"ada@{domain}", ["staff", "pathologists"])
    assert sso_login(browser, domain).status_code == 200
    assert membership_of(browser, tenant_id) == [("reviewer", False)]
    assert browser.sql(
        f"SELECT active_tenant_id::text FROM sessions WHERE subject = '{browser.idp.subject}'"
    ) == [(tenant_id,)]
    assert browser.sql(f"SELECT email FROM users WHERE subject = '{browser.idp.subject}'") == [
        (f"ada@{domain}",)
    ]
    assert browser.sql(
        "SELECT details::jsonb->>'source' FROM audit_events "
        f"WHERE tenant_id = '{tenant_id}' AND action = 'member.added'"
    ) == [("sso",)]


def test_a_user_without_a_mapped_group_gets_the_default_role(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(
        browser, default_role="researcher", group_roles={"pathologists": "reviewer"}
    )
    as_sso_user(browser, organisation, f"ben@{domain}", ["staff"])
    sso_login(browser, domain)
    assert membership_of(browser, tenant_id) == [("researcher", False)]


def test_researcher_wins_when_groups_map_to_both_roles(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(
        browser, default_role=None, group_roles={"a": "reviewer", "b": "researcher"}
    )
    as_sso_user(browser, organisation, f"cy@{domain}", ["a", "b"])
    sso_login(browser, domain)
    assert membership_of(browser, tenant_id) == [("researcher", False)]


def test_no_default_and_no_mapped_group_gives_no_membership(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(
        browser, default_role=None, group_roles={"pathologists": "reviewer"}
    )
    as_sso_user(browser, organisation, f"dee@{domain}", ["staff"])
    assert sso_login(browser, domain).status_code == 200
    assert membership_of(browser, tenant_id) == []


def test_a_changed_group_changes_the_role_on_the_next_login(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(
        browser, default_role="researcher", group_roles={"pathologists": "reviewer"}
    )
    as_sso_user(browser, organisation, f"eve@{domain}", ["pathologists"])
    sso_login(browser, domain)
    as_sso_user(browser, organisation, f"eve@{domain}", [])
    sso_login(browser, domain)
    assert membership_of(browser, tenant_id) == [("researcher", False)]
    assert browser.sql(
        "SELECT details::jsonb->>'from', details::jsonb->>'to' FROM audit_events "
        f"WHERE tenant_id = '{tenant_id}' AND action = 'member.role-changed'"
    ) == [("reviewer", "researcher")]


def test_an_email_outside_the_workspace_domains_is_not_trusted(browser: Browser) -> None:
    tenant_id, organisation, domain = make_connection(browser)
    as_sso_user(browser, organisation, "owner@parfocal.eu", [])
    sso_login(browser, domain)
    assert browser.sql(f"SELECT email FROM users WHERE subject = '{browser.idp.subject}'") == [
        (None,)
    ]
    assert membership_of(browser, tenant_id) == [("researcher", False)]


def test_a_user_from_another_organisation_gets_no_membership(browser: Browser) -> None:
    tenant_id, _, domain = make_connection(browser)
    as_sso_user(browser, "some-other-organisation", f"fay@{domain}", [])
    sso_login(browser, domain)
    assert membership_of(browser, tenant_id) == []


@pytest.mark.parametrize(
    ("claims", "groups"),
    [
        ({}, []),
        ({METADATA_CLAIM: {GROUPS_KEY: "not base64 json!"}}, []),
        ({METADATA_CLAIM: {GROUPS_KEY: base64.b64encode(b'"one"').decode()}}, ["one"]),
        ({METADATA_CLAIM: {GROUPS_KEY: base64.b64encode(b'{"a": 1}').decode()}}, []),
        ({METADATA_CLAIM: groups_claim(["x", "y"])}, ["x", "y"]),
    ],
)
def test_groups_are_read_from_the_metadata_claim(
    claims: dict[str, object], groups: list[str]
) -> None:
    assert groups_of(claims) == groups
