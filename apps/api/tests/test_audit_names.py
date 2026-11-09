import json
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, give_security_contact, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

EVENTS = "/api/tenant/audit-events"
SHOWN_NAME = "Shown Name Alpha"


def workspace_with_history(api: ApiAs, database: str) -> Workspace:
    workspace = make_workspace(
        database,
        {"admin": Role.RESEARCHER, "owner": Role.RESEARCHER, "reviewer": Role.REVIEWER},
        admins={"admin"},
    )
    give_security_contact(database, workspace.tenant_id)
    owner(
        database,
        f"UPDATE users SET display_name = '{SHOWN_NAME}' "
        f"WHERE id = '{workspace.people['owner'].user_id}'",
    )
    created = api(workspace.people["owner"]).post("/api/projects", json={"name": "Named"})
    assert created.status_code == 201, created.text
    return workspace


def trail(api: ApiAs, who: MemberPrincipal) -> list[dict[str, Any]]:
    response = api(who).get(EVENTS)
    assert response.status_code == 200, response.text
    return list(response.json())


def created_by_owner(events: list[dict[str, Any]]) -> dict[str, Any]:
    return next(event for event in events if event["action"] == "project.created")


def test_an_admin_sees_the_names_of_members_who_acted(api: ApiAs, database: str) -> None:
    workspace = workspace_with_history(api, database)
    event = created_by_owner(trail(api, workspace.people["admin"]))
    assert event["actor_name"] == SHOWN_NAME
    assert event["actor_user_id"] == str(workspace.people["owner"].user_id)
    assert event["actor_id"] != event["actor_user_id"]


def test_people_without_the_audit_right_get_no_names(api: ApiAs, database: str) -> None:
    workspace = workspace_with_history(api, database)
    for label in ("owner", "reviewer"):
        response = api(workspace.people[label]).get(EVENTS)
        assert response.status_code == 403
        assert SHOWN_NAME not in response.text


def test_another_workspace_never_resolves_these_people(api: ApiAs, database: str) -> None:
    mine = workspace_with_history(api, database)
    theirs = workspace_with_history(api, database)
    seen = json.dumps(trail(api, theirs.people["admin"]))
    for person in mine.people.values():
        assert str(person.user_id) not in seen
        assert person.subject not in seen


def test_someone_who_left_the_workspace_stays_a_pseudonym(api: ApiAs, database: str) -> None:
    workspace = workspace_with_history(api, database)
    leaver = workspace.people["owner"]
    owner(
        database,
        f"DELETE FROM memberships WHERE user_id = '{leaver.user_id}' "
        f"AND tenant_id = '{workspace.tenant_id}'",
    )
    event = created_by_owner(trail(api, workspace.people["admin"]))
    assert (event["actor_name"], event["actor_user_id"]) == (None, None)
    assert event["actor_id"] is not None


def test_the_signed_export_carries_pseudonyms_only(api: ApiAs, database: str) -> None:
    workspace = workspace_with_history(api, database)
    response = api(workspace.people["admin"]).get(f"{EVENTS}/export")
    assert response.status_code == 200, response.text
    assert SHOWN_NAME not in response.text
    assert str(workspace.people["owner"].user_id) not in response.text
    for event in response.json()["events"]:
        assert "actor_name" not in event
        assert "actor_user_id" not in event
        assert event["actor_kind"] != "member" or event["actor_id"] is not None
