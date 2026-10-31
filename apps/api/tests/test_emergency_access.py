import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REASON = "Patient called the department about this result"


@dataclass(frozen=True)
class Lab:
    workspace: Workspace
    clinical: uuid.UUID
    other: uuid.UUID
    de_identified: uuid.UUID
    case: str

    def who(self, label: str) -> MemberPrincipal:
        return self.workspace.people[label]


def make_lab(api: ApiAs, database: str) -> Lab:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "outsider": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
            "admin": Role.RESEARCHER,
        },
        admins={"admin"},
    )
    tenant = workspace.tenant_id
    clinical, other = make_project(database, tenant), make_project(database, tenant)
    de_identified = make_project(database, tenant, "de-identified")
    for project in (clinical, other, de_identified):
        join_project(database, project, workspace.people["owner"], "owner")
    case = api(workspace.people["owner"]).post(
        "/api/cases",
        json={"project_id": str(clinical), "label": "S26-04812", "patient": {"name": "Eva"}},
    )
    assert case.status_code == 201, case.text
    return Lab(workspace, clinical, other, de_identified, case.json()["id"])


def ask(api: ApiAs, lab: Lab, who: str, project: uuid.UUID, reason: str = REASON) -> Any:
    return api(lab.who(who)).post(
        f"/api/projects/{project}/emergency-access", json={"reason": reason}
    )


def opens(api: ApiAs, lab: Lab, who: str) -> tuple[int, str | None]:
    response = api(lab.who(who)).get(f"/api/cases/{lab.case}")
    return response.status_code, response.json().get("code")


@pytest.mark.parametrize("who", ["admin", "outsider"])
def test_a_reason_opens_one_clinical_project_for_a_while(
    api: ApiAs, database: str, who: str
) -> None:
    lab = make_lab(api, database)
    assert opens(api, lab, who) == (403, "emergency-access-needed")
    granted = ask(api, lab, who, lab.clinical)
    assert granted.status_code == 201, granted.text
    expires = datetime.fromisoformat(granted.json()["expires_at"])
    assert timedelta(hours=3, minutes=59) < expires - datetime.now(UTC) <= timedelta(hours=4)
    client = api(lab.who(who))
    body = client.get(f"/api/cases/{lab.case}").json()
    assert body["patient"]["name"] == "Eva"
    assert client.get(f"/api/projects/{lab.clinical}").json()["my_role"] is None
    listed = client.get("/api/cases", params={"project_id": str(lab.clinical)}).json()
    assert [row["id"] for row in listed] == [lab.case]
    other = client.get(f"/api/projects/{lab.other}")
    assert (other.status_code, other.json()["code"]) == (403, "emergency-access-needed")
    refused = client.post("/api/cases", json={"project_id": str(lab.clinical), "label": "X-1"})
    assert refused.status_code in {403, 404}


def test_admin_rights_list_no_cases_without_a_grant(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    listed = api(lab.who("admin")).get("/api/cases")
    assert (listed.status_code, listed.json()) == (200, [])


def test_the_audit_entry_carries_the_reason(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    ask(api, lab, "admin", lab.clinical)
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{lab.clinical}' AND action = 'project.emergency-access'",
    )
    assert details == [(f'{{"hours":4,"reason":"{REASON}","role":"researcher"}}',)]


def test_a_grant_expires(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    ask(api, lab, "admin", lab.clinical)
    owner(
        database,
        "UPDATE emergency_grants SET expires_at = now() - interval '1 second' "
        f"WHERE project_id = '{lab.clinical}'",
    )
    assert opens(api, lab, "admin") == (403, "emergency-access-needed")


@pytest.mark.parametrize("reason", ["", "   ", "too short", "x" * 501])
def test_a_reason_is_required(api: ApiAs, database: str, reason: str) -> None:
    lab = make_lab(api, database)
    assert ask(api, lab, "admin", lab.clinical, reason).status_code == 422
    assert opens(api, lab, "admin")[0] == 403


def test_de_identified_projects_and_members_need_no_emergency_path(
    api: ApiAs, database: str
) -> None:
    lab = make_lab(api, database)
    refused = ask(api, lab, "admin", lab.de_identified)
    assert (refused.status_code, refused.json()["code"]) == (409, "no-emergency-access")
    hidden = api(lab.who("admin")).get(f"/api/projects/{lab.de_identified}")
    assert hidden.status_code == 404
    member = ask(api, lab, "owner", lab.clinical)
    assert (member.status_code, member.json()["code"]) == (409, "already-in-project")
    assert ask(api, lab, "reviewer", lab.clinical).status_code == 403
    assert opens(api, lab, "reviewer") == (404, "not-found")
    assert ask(api, lab, "admin", uuid.uuid4()).status_code == 404


def test_the_database_refuses_a_grant_on_a_de_identified_project(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    admin = lab.who("admin")
    with pytest.raises(Exception, match="foreign key"):
        owner(
            database,
            "INSERT INTO emergency_grants (tenant_id, user_id, project_id, reason, expires_at) "
            f"VALUES ('{admin.tenant_id}', '{admin.user_id}', '{lab.de_identified}', "
            f"'{REASON}', now() + interval '1 hour')",
        )


def test_the_workspace_sets_how_long_a_grant_lasts(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    policy = {"idle_lock_minutes": 15, "session_hours": 12, "emergency_hours": 1}
    assert api(lab.who("admin")).put("/api/tenant/session-policy", json=policy).status_code == 200
    expires = datetime.fromisoformat(ask(api, lab, "admin", lab.clinical).json()["expires_at"])
    assert expires - datetime.now(UTC) <= timedelta(hours=1)
