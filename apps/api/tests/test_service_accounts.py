import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from idp_support import Browser

from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("service-operator")
ACCOUNTS = "/api/tenant/service-accounts"


@dataclass(frozen=True)
class Workspace:
    tenant_id: str
    admin: MemberPrincipal


def make_workspace(api: ApiAs, browser: Browser) -> Workspace:
    slug = f"svc-{uuid.uuid4().hex[:10]}"
    organisation = api(OPERATOR).post(
        "/api/platform/organisations", json={"slug": slug, "name": slug}
    )
    tenant_id = (
        api(OPERATOR)
        .post(
            "/api/platform/tenants",
            json={
                "organisation_id": organisation.json()["id"],
                "slug": slug,
                "name": slug,
                "kind": "diagnostic",
                "region": "eu",
            },
        )
        .json()["id"]
    )
    subject = f"{slug}-admin"
    user_id = browser.sql(
        "INSERT INTO users (subject, display_name, initials, avatar_colour) "
        f"VALUES ('{subject}', 'Admin {slug}', 'AD', 2) RETURNING id"
    )[0][0]
    api(OPERATOR).post(
        f"/api/platform/tenants/{tenant_id}/members",
        json={"user_id": str(user_id), "role": "researcher", "admin_rights": True},
    )
    admin = MemberPrincipal(
        subject, uuid.UUID(tenant_id), uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )
    return Workspace(tenant_id, admin)


def create(api: ApiAs, workspace: Workspace, scopes: list[str], **extra: Any) -> dict[str, Any]:
    response = api(workspace.admin).post(
        ACCOUNTS, json={"name": f"LIS {uuid.uuid4().hex[:6]}", "scopes": scopes, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()


def as_service(browser: Browser, token: str, path: str, method: str = "GET") -> int:
    headers = {"Authorization": f"Bearer {token}"}
    return browser.client.request(method, path, headers=headers).status_code


def test_a_token_reaches_only_what_its_scopes_allow(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    token = create(api, workspace, ["see-people"])["token"]["token"]
    assert token.startswith("pf_")
    assert as_service(browser, token, "/api/tenant/members") == 200
    assert as_service(browser, token, "/api/tenant") == 200
    for refused in ("/api/tenant/audit-events", ACCOUNTS, "/api/me", "/api/auth/session"):
        assert as_service(browser, token, refused) == 403, refused
    assert as_service(browser, token, "/api/platform/tenants") == 403


def test_a_token_without_a_scope_is_refused_that_route(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    token = create(api, workspace, ["upload-slides"])["token"]["token"]
    assert as_service(browser, token, "/api/tenant/members") == 403


def test_a_token_sees_only_its_own_workspace(api: ApiAs, browser: Browser) -> None:
    mine, theirs = make_workspace(api, browser), make_workspace(api, browser)
    token = create(api, mine, ["see-people"])["token"]["token"]
    response = browser.client.get(
        "/api/tenant/members", headers={"Authorization": f"Bearer {token}"}
    )
    assert [member["user_id"] for member in response.json()] == [str(mine.admin.user_id)]
    assert str(theirs.admin.user_id) not in response.text


def test_revoking_a_token_takes_effect_on_the_next_request(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    account_id, token = created["account"]["id"], created["token"]
    assert as_service(browser, token["token"], "/api/tenant/members") == 200
    revoke = f"{ACCOUNTS}/{account_id}/tokens/{token['id']}"
    assert api(workspace.admin).delete(revoke).status_code == 204
    assert as_service(browser, token["token"], "/api/tenant/members") == 401
    assert api(workspace.admin).delete(revoke).status_code == 204


def test_rotation_overlaps_old_and_new_tokens(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    account_id, old = created["account"]["id"], created["token"]
    new = api(workspace.admin).post(f"{ACCOUNTS}/{account_id}/tokens", json={"expires_in_days": 30})
    assert new.status_code == 201
    assert as_service(browser, old["token"], "/api/tenant/members") == 200
    assert as_service(browser, new.json()["token"], "/api/tenant/members") == 200
    api(workspace.admin).delete(f"{ACCOUNTS}/{account_id}/tokens/{old['id']}")
    assert as_service(browser, old["token"], "/api/tenant/members") == 401
    assert as_service(browser, new.json()["token"], "/api/tenant/members") == 200
    listed = api(workspace.admin).get(ACCOUNTS).json()
    assert [len(account["tokens"]) for account in listed] == [2]
    assert listed[0]["tokens"][0]["revoked_at"] is not None
    assert listed[0]["tokens"][1]["last_used_at"] is not None


def test_disabling_an_account_stops_all_its_tokens(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    account_id = created["account"]["id"]
    disabled = api(workspace.admin).post(f"{ACCOUNTS}/{account_id}/disable")
    assert disabled.json()["disabled_at"] is not None
    assert as_service(browser, created["token"]["token"], "/api/tenant/members") == 401
    again = api(workspace.admin).post(f"{ACCOUNTS}/{account_id}/tokens", json={})
    assert (again.status_code, again.json()["code"]) == (409, "service-account-disabled")


def test_expired_and_unknown_tokens_are_refused(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    browser.sql(
        "UPDATE api_tokens SET expires_at = now() - interval '1 second' "
        f"WHERE id = '{created['token']['id']}'"
    )
    assert as_service(browser, created["token"]["token"], "/api/tenant/members") == 401
    assert as_service(browser, "pf_unknown", "/api/tenant/members") == 401
    basic = browser.client.get("/api/tenant/members", headers={"Authorization": "Basic eDp5"})
    assert basic.status_code == 401


def test_tokens_are_stored_only_as_hashes(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    rows = browser.sql(
        f"SELECT api_tokens::text FROM api_tokens WHERE id = '{created['token']['id']}'"
    )
    assert created["token"]["token"] not in str(rows[0][0])
    listed = api(workspace.admin).get(ACCOUNTS).text
    assert created["token"]["token"] not in listed


@pytest.mark.parametrize(
    "draft",
    [
        {"name": "x", "scopes": []},
        {"name": "x", "scopes": ["sign-out"]},
        {"name": "x", "scopes": ["manage-people"]},
        {"name": " ", "scopes": ["see-people"]},
        {"name": "x", "scopes": ["see-people"], "expires_in_days": 366},
    ],
)
def test_invalid_accounts_are_refused(api: ApiAs, browser: Browser, draft: dict[str, Any]) -> None:
    workspace = make_workspace(api, browser)
    assert api(workspace.admin).post(ACCOUNTS, json=draft).status_code == 422


def test_names_are_unique_per_workspace(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    draft = {"name": "LIS adapter", "scopes": ["create-cases"]}
    assert api(workspace.admin).post(ACCOUNTS, json=draft).status_code == 201
    again = api(workspace.admin).post(ACCOUNTS, json=draft)
    assert (again.status_code, again.json()["code"]) == (409, "service-account-name-taken")


def test_each_step_is_audited(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    created = create(api, workspace, ["see-people"])
    account_id = created["account"]["id"]
    api(workspace.admin).delete(f"{ACCOUNTS}/{account_id}/tokens/{created['token']['id']}")
    api(workspace.admin).post(f"{ACCOUNTS}/{account_id}/disable")
    trail = (
        api(workspace.admin)
        .get(
            "/api/tenant/audit-events",
            params={"target_type": "service-account", "target_id": account_id},
        )
        .json()
    )
    assert [event["action"] for event in trail] == [
        "service-account.created",
        "api-token.issued",
        "api-token.revoked",
        "service-account.disabled",
    ]
    assert {event["actor_subject"] for event in trail} == {workspace.admin.subject}
