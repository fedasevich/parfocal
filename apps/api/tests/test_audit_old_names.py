from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, give_security_contact, make_workspace, owner

from parfocal_api.audit import AuditAction, AuditEvent, chain_breaks
from parfocal_api.legacy_names import OLD_AUDIT_ACTIONS
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

EVENTS = "/api/tenant/audit-events"
OLD_SET, OLD_CLEARED = OLD_AUDIT_ACTIONS


def workspace_with_old_entries(database: str) -> Workspace:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER}, admins={"admin"})
    give_security_contact(database, workspace.tenant_id)
    for action in (OLD_SET, OLD_CLEARED):
        owner(
            database,
            "INSERT INTO audit_events (tenant_id, actor_kind, action, target_type, details) "
            f"VALUES ('{workspace.tenant_id}', 'service', '{action}', 'slide', '{{}}')",
        )
    return workspace


def listed(api: ApiAs, who: MemberPrincipal, **params: Any) -> list[str]:
    response = api(who).get(EVENTS, params=params)
    assert response.status_code == 200, response.text
    return [event["action"] for event in response.json() if event["target_type"] == "slide"]


def test_entries_stored_under_the_old_names_read_as_the_new_ones(api: ApiAs, database: str) -> None:
    admin = workspace_with_old_entries(database).people["admin"]
    renamed = [AuditAction.REVIEW_OBJECT_DECIDED, AuditAction.REVIEW_OBJECT_DECISION_CLEARED]
    assert listed(api, admin) == renamed
    assert listed(api, admin, action=AuditAction.REVIEW_OBJECT_DECIDED) == renamed[:1]
    assert listed(api, admin, action_prefix="review.object-decision") == renamed[1:]


def test_the_export_keeps_the_stored_names_so_the_chain_still_verifies(
    api: ApiAs, database: str
) -> None:
    admin = workspace_with_old_entries(database).people["admin"]
    response = api(admin).get(f"{EVENTS}/export")
    assert response.status_code == 200, response.text
    events = [AuditEvent.model_validate(event) for event in response.json()["events"]]
    assert [event.action for event in events if event.target_type == "slide"] == [
        OLD_SET,
        OLD_CLEARED,
    ]
    assert chain_breaks(events) == []
