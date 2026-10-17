import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_project, make_workspace, owner

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REASON = "Patient called the department about this result"


@dataclass(frozen=True)
class Lab:
    workspace: Workspace
    cases: list[str]

    def who(self, label: str) -> Any:
        return self.workspace.people[label]


def make_lab(api: ApiAs, database: str) -> Lab:
    workspace = make_workspace(
        database,
        {"researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER, "admin": Role.ADMIN},
    )
    project = make_project(database, workspace.tenant_id)
    cases = [
        api(workspace.people["researcher"])
        .post(
            "/api/cases",
            json={
                "project_id": str(project),
                "label": f"EM-{uuid.uuid4().hex[:8]}",
                "patient": {"name": f"Patient {index}"},
                "specimens": [{"letter": "A"}],
            },
        )
        .json()["id"]
        for index in range(2)
    ]
    return Lab(workspace, cases)


def ask(api: ApiAs, lab: Lab, who: str, case: str, reason: str = REASON) -> Any:
    return api(lab.who(who)).post(f"/api/cases/{case}/emergency-access", json={"reason": reason})


def opens(api: ApiAs, lab: Lab, who: str, case: str) -> tuple[int, str | None]:
    response = api(lab.who(who)).get(f"/api/cases/{case}")
    return response.status_code, response.json().get("code")


def test_an_administrator_reads_one_patient_only_with_a_reason(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    first, second = lab.cases
    assert opens(api, lab, "admin", first) == (403, "emergency-access-needed")
    assert api(lab.who("admin")).get("/api/cases").status_code == 403
    granted = ask(api, lab, "admin", first)
    assert granted.status_code == 201
    expires = datetime.fromisoformat(granted.json()["expires_at"])
    assert timedelta(hours=3, minutes=59) < expires - datetime.now(UTC) <= timedelta(hours=4)
    body = api(lab.who("admin")).get(f"/api/cases/{first}").json()
    assert body["patient"]["name"] == "Patient 0"
    assert opens(api, lab, "admin", second) == (403, "emergency-access-needed")


def test_the_audit_entry_carries_the_reason(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    case = lab.cases[0]
    ask(api, lab, "admin", case)
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{case}' AND action = 'case.emergency-access'",
    )
    assert details == [(f'{{"hours":4,"reason":"{REASON}","role":"admin"}}',)]


def test_a_grant_expires(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    case = lab.cases[0]
    ask(api, lab, "admin", case)
    owner(
        database,
        "UPDATE emergency_grants SET expires_at = now() - interval '1 second' "
        f"WHERE case_id = '{case}'",
    )
    assert opens(api, lab, "admin", case) == (403, "emergency-access-needed")


@pytest.mark.parametrize("reason", ["", "   ", "too short", "x" * 501])
def test_a_reason_is_required(api: ApiAs, database: str, reason: str) -> None:
    lab = make_lab(api, database)
    case = lab.cases[0]
    assert ask(api, lab, "admin", case, reason).status_code == 422
    assert opens(api, lab, "admin", case)[0] == 403


def test_roles_that_see_cases_need_no_reason_and_cannot_ask(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    case = lab.cases[0]
    for role in ("researcher", "reviewer"):
        assert opens(api, lab, role, case)[0] == 200
        assert ask(api, lab, role, case).status_code == 403


def test_the_workspace_sets_how_long_a_grant_lasts(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    policy = {"idle_lock_minutes": 15, "session_hours": 12, "emergency_hours": 1}
    assert api(lab.who("admin")).put("/api/tenant/session-policy", json=policy).status_code == 200
    expires = datetime.fromisoformat(ask(api, lab, "admin", lab.cases[0]).json()["expires_at"])
    assert expires - datetime.now(UTC) <= timedelta(hours=1)
