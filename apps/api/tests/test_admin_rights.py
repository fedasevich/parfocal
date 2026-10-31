import uuid
from dataclasses import replace

import pytest
from db_support import ApiAs
from idp_support import Browser
from sqlalchemy.exc import IntegrityError
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("rights-operator")
RIGHTS_EVENTS = ("member.admin-rights-given", "member.admin-rights-removed")


def team(database: str) -> Workspace:
    return make_workspace(
        database,
        {"lead": Role.RESEARCHER, "deputy": Role.RESEARCHER, "doctor": Role.REVIEWER},
        admins={"lead"},
    )


def rights(w: Workspace, label: str) -> str:
    return f"/api/tenant/members/{w.people[label].user_id}/admin-rights"


def holders(database: str, w: Workspace) -> set[str]:
    rows = owner(
        database,
        f"SELECT user_id FROM memberships WHERE tenant_id = '{w.tenant_id}' AND admin_rights",
    )
    by_id = {str(who.user_id): label for label, who in w.people.items()}
    return {by_id[str(row[0])] for row in rows}


def rights_trail(api: ApiAs, reader: MemberPrincipal) -> list[tuple[str, str | None, str | None]]:
    events = api(reader).get("/api/tenant/audit-events").json()
    return [
        (event["action"], event["actor_subject"], event["target_subject"])
        for event in events
        if event["action"] in RIGHTS_EVENTS
    ]


def test_admin_rights_are_given_and_removed_with_an_audit_entry(api: ApiAs, database: str) -> None:
    w = team(database)
    lead, deputy = w.people["lead"], w.people["deputy"]
    given = api(lead).put(rights(w, "deputy"), json={"admin_rights": True})
    assert given.status_code == 200
    assert (given.json()["role"], given.json()["admin_rights"]) == ("researcher", True)
    assert api(lead).put(rights(w, "deputy"), json={"admin_rights": True}).status_code == 200
    listed = {
        member["user_id"]: member["admin_rights"]
        for member in api(lead).get("/api/tenant/members").json()
    }
    assert listed == {
        str(lead.user_id): True,
        str(deputy.user_id): True,
        str(w.people["doctor"].user_id): False,
    }
    holder = replace(deputy, admin_rights=True)
    removed = api(holder).put(rights(w, "lead"), json={"admin_rights": False})
    assert (removed.status_code, removed.json()["admin_rights"]) == (200, False)
    assert holders(database, w) == {"deputy"}
    assert rights_trail(api, holder) == [
        ("member.admin-rights-given", lead.subject, deputy.subject),
        ("member.admin-rights-removed", deputy.subject, lead.subject),
    ]


def test_the_last_holder_cannot_give_up_admin_rights(api: ApiAs, database: str) -> None:
    w = team(database)
    lead = w.people["lead"]
    refused = api(lead).put(rights(w, "lead"), json={"admin_rights": False})
    assert (refused.status_code, refused.json()["code"]) == (409, "last-admin")
    assert holders(database, w) == {"lead"}
    assert rights_trail(api, lead) == []
    api(lead).put(rights(w, "deputy"), json={"admin_rights": True})
    assert api(lead).put(rights(w, "lead"), json={"admin_rights": False}).status_code == 200
    assert holders(database, w) == {"deputy"}


def test_a_reviewer_never_holds_admin_rights(api: ApiAs, database: str) -> None:
    w = team(database)
    lead = w.people["lead"]
    refused = api(lead).put(rights(w, "doctor"), json={"admin_rights": True})
    assert (refused.status_code, refused.json()["code"]) == (409, "admin-rights-need-researcher")
    assert holders(database, w) == {"lead"}
    with pytest.raises(IntegrityError):
        owner(
            database,
            "UPDATE memberships SET admin_rights = true "
            f"WHERE user_id = '{w.people['doctor'].user_id}'",
        )
    api(lead).put(rights(w, "deputy"), json={"admin_rights": True})
    demoted = api(lead).put(
        f"/api/tenant/members/{w.people['deputy'].user_id}/role", json={"role": "reviewer"}
    )
    assert (demoted.status_code, demoted.json()["code"]) == (409, "holds-admin-rights")
    unknown = api(lead).put(
        f"/api/tenant/members/{uuid.uuid4()}/admin-rights", json={"admin_rights": True}
    )
    assert unknown.status_code == 404
    draft = {"user_id": str(w.people["doctor"].user_id), "role": "reviewer", "admin_rights": True}
    added = api(OPERATOR).post(f"/api/platform/tenants/{w.tenant_id}/members", json=draft)
    assert added.status_code == 422
    assert rights_trail(api, lead) == [
        ("member.admin-rights-given", lead.subject, w.people["deputy"].subject)
    ]


def test_a_session_gains_and_loses_the_setup_permissions_with_the_right(
    api: ApiAs, browser: Browser, database: str
) -> None:
    w = team(database)
    browser.login()
    user_id = browser.sql(f"SELECT id FROM users WHERE subject = '{browser.idp.subject}'")[0][0]
    browser.sql(
        "INSERT INTO memberships (tenant_id, user_id, role) "
        f"VALUES ('{w.tenant_id}', '{user_id}', 'researcher')"
    )
    assert (
        browser.client.put("/api/me/workspace", json={"tenant_id": str(w.tenant_id)}).status_code
        == 200
    )
    path = f"/api/tenant/members/{user_id}/admin-rights"
    assert browser.client.get("/api/tenant/audit-events").status_code == 403
    assert api(w.people["lead"]).put(path, json={"admin_rights": True}).status_code == 200
    assert browser.client.get("/api/tenant/audit-events").status_code == 200
    workspaces = browser.client.get("/api/me").json()["workspaces"]
    assert [(item["role"], item["admin_rights"]) for item in workspaces] == [("researcher", True)]
    assert api(w.people["lead"]).put(path, json={"admin_rights": False}).status_code == 200
    assert browser.client.get("/api/tenant/audit-events").status_code == 403
