import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

import pytest
from db_support import ApiAs
from idp_support import Browser

from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_api.tables import Role
from parfocal_common.clients import MemoryEmailSender

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("invite-operator")
INVITATIONS = "/api/tenant/invitations"


@dataclass(frozen=True)
class Workspace:
    tenant_id: str
    admin: MemberPrincipal


def make_workspace(api: ApiAs, browser: Browser) -> Workspace:
    slug = f"inv-{uuid.uuid4().hex[:10]}"
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
        "INSERT INTO users (subject, email, display_name, initials, avatar_colour) "
        f"VALUES ('{subject}', '{slug}@example.test', 'Admin', 'AD', 2) RETURNING id"
    )[0][0]
    api(OPERATOR).post(
        f"/api/platform/tenants/{tenant_id}/members",
        json={"user_id": str(user_id), "role": "researcher", "admin_rights": True},
    )
    admin = MemberPrincipal(
        subject, uuid.UUID(tenant_id), uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )
    return Workspace(tenant_id, admin)


def outbox(api: ApiAs) -> MemoryEmailSender:
    return cast("MemoryEmailSender", cast("Any", api.client.app).clients.email)


def invite(api: ApiAs, workspace: Workspace, email: str, role: str = "reviewer") -> str:
    response = api(workspace.admin).post(INVITATIONS, json={"email": email, "role": role})
    assert response.status_code == 201, response.text
    message = outbox(api).sent[-1]
    assert (message.to, message.template) == (email.lower(), "invitation")
    assert message.link.startswith("http://localhost:5173/invitations/")
    return message.link.rsplit("/", 1)[1]


def invitee(browser: Browser, email: str, verified: bool = True) -> Browser:
    browser.idp.claim_overrides = {"email": email, "email_verified": verified}
    browser.login()
    return browser


def accept(browser: Browser, token: str) -> Any:
    return browser.client.post("/api/invitations/accept", json={"token": token})


def fresh_email() -> str:
    return f"person-{uuid.uuid4().hex[:8]}@example.test"


def trail(api: ApiAs, workspace: Workspace) -> list[str]:
    events = api(workspace.admin).get("/api/tenant/audit-events").json()
    return [event["action"] for event in events]


def test_an_invited_person_joins_with_the_role(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    token = invite(api, workspace, email.upper(), "researcher")
    listed = api(workspace.admin).get(INVITATIONS).json()
    assert [(item["email"], item["role"], item["expired"]) for item in listed] == [
        (email, "researcher", False)
    ]
    joined = accept(invitee(browser, email), token)
    assert joined.status_code == 200, joined.text
    assert (joined.json()["tenant_id"], joined.json()["role"]) == (
        workspace.tenant_id,
        "researcher",
    )
    assert browser.client.get("/api/tenant").json()["id"] == workspace.tenant_id
    assert api(workspace.admin).get(INVITATIONS).json() == []
    assert trail(api, workspace)[-3:] == [
        "invitation.created",
        "invitation.accepted",
        "member.added",
    ]
    again = accept(browser, token)
    assert (again.status_code, again.json()["code"]) == (409, "invitation-used")


def test_an_invitation_for_another_address_is_refused(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    token = invite(api, workspace, fresh_email())
    refused = accept(invitee(browser, fresh_email()), token)
    assert (refused.status_code, refused.json()["code"]) == (403, "invitation-for-someone-else")
    assert len(api(workspace.admin).get(INVITATIONS).json()) == 1


def test_an_unverified_address_cannot_accept(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    token = invite(api, workspace, email)
    refused = accept(invitee(browser, email, verified=False), token)
    assert (refused.status_code, refused.json()["code"]) == (403, "invitation-for-someone-else")


def test_an_expired_invitation_is_refused_and_audited(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    token = invite(api, workspace, email)
    browser.sql(
        "UPDATE invitations SET expires_at = now() - interval '1 second' "
        f"WHERE tenant_id = '{workspace.tenant_id}'"
    )
    refused = accept(invitee(browser, email), token)
    assert (refused.status_code, refused.json()["code"]) == (410, "invitation-expired")
    assert trail(api, workspace)[-1] == "invitation.expired"
    assert [item["expired"] for item in api(workspace.admin).get(INVITATIONS).json()] == [True]
    assert browser.client.get("/api/tenant").status_code == 403


def test_a_withdrawn_invitation_no_longer_works(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    token = invite(api, workspace, email)
    invitation_id = api(workspace.admin).get(INVITATIONS).json()[0]["id"]
    assert api(workspace.admin).delete(f"{INVITATIONS}/{invitation_id}").status_code == 204
    assert api(workspace.admin).delete(f"{INVITATIONS}/{invitation_id}").status_code == 404
    refused = accept(invitee(browser, email), token)
    assert (refused.status_code, refused.json()["code"]) == (404, "invitation-not-found")
    assert trail(api, workspace)[-1] == "invitation.revoked"


def test_inviting_again_replaces_the_earlier_link(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    first = invite(api, workspace, email)
    second = invite(api, workspace, email, "researcher")
    assert trail(api, workspace)[-3:] == [
        "invitation.created",
        "invitation.revoked",
        "invitation.created",
    ]
    invitee(browser, email)
    assert accept(browser, first).status_code == 404
    assert accept(browser, second).json()["role"] == "researcher"


def test_members_cannot_be_invited_again(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = browser.sql(f"SELECT email FROM users WHERE id = '{workspace.admin.user_id}'")[0][0]
    response = api(workspace.admin).post(INVITATIONS, json={"email": email, "role": "researcher"})
    assert (response.status_code, response.json()["code"]) == (409, "already-a-member")


def test_an_operator_invites_the_first_administrator(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    response = api(OPERATOR).post(
        f"/api/platform/tenants/{workspace.tenant_id}/invitations",
        json={"email": email, "role": "researcher", "admin_rights": True},
    )
    assert response.status_code == 201
    assert (response.json()["role"], response.json()["admin_rights"]) == ("researcher", True)
    token = outbox(api).sent[-1].link.rsplit("/", 1)[1]
    joined = accept(invitee(browser, email), token).json()
    assert (joined["role"], joined["admin_rights"]) == ("researcher", True)
    session = browser.client.get("/api/tenant/audit-events")
    assert session.status_code == 200
    added = [event for event in session.json() if event["action"] == "member.added"][-1]
    assert json.loads(added["details"])["admin_rights"] is True
    unknown = api(OPERATOR).post(
        f"/api/platform/tenants/{uuid.uuid4()}/invitations",
        json={"email": email, "role": "researcher"},
    )
    assert unknown.status_code == 404


def test_a_suspended_workspace_cannot_be_joined(api: ApiAs, browser: Browser) -> None:
    workspace = make_workspace(api, browser)
    email = fresh_email()
    token = invite(api, workspace, email)
    api(OPERATOR).post(f"/api/platform/tenants/{workspace.tenant_id}/suspend")
    refused = accept(invitee(browser, email), token)
    assert (refused.status_code, refused.json()["code"]) == (403, "tenant-suspended")


def test_unknown_tokens_and_anonymous_callers_are_refused(browser: Browser) -> None:
    anonymous = browser.client.post("/api/invitations/accept", json={"token": "nothing"})
    assert anonymous.status_code == 401
    browser.login()
    unknown = accept(browser, "nothing")
    assert (unknown.status_code, unknown.json()["code"]) == (404, "invitation-not-found")


@pytest.mark.parametrize(
    "draft",
    [
        {"email": "not-an-address", "role": "researcher"},
        {"email": "person@example.test", "role": "outside-consultant"},
        {"email": "person@example.test", "role": "secretary"},
        {"email": "person@example.test", "role": "admin"},
        {"email": "person@example.test", "role": "reviewer", "admin_rights": True},
    ],
)
def test_invalid_invitations_are_refused(
    api: ApiAs, browser: Browser, draft: dict[str, object]
) -> None:
    workspace = make_workspace(api, browser)
    assert api(workspace.admin).post(INVITATIONS, json=draft).status_code == 422
