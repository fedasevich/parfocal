from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from test_folder_access import Lab, make_lab, owner, person

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REASON = "Patient called the department about this result"


def ask(api: ApiAs, lab: Lab, who: str, case: str, reason: str = REASON) -> Any:
    return api(lab.people[who]).post(
        f"/api/cases/{lab.cases[case]}/emergency-access", json={"reason": reason}
    )


def opens(api: ApiAs, lab: Lab, who: str, case: str) -> tuple[int, str | None]:
    response = api(lab.people[who]).get(f"/api/cases/{lab.cases[case]}")
    return response.status_code, response.json().get("code")


def test_a_reason_opens_one_case_outside_the_folders(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    assert opens(api, lab, "nodes", "skin") == (403, "outside-folders")
    granted = ask(api, lab, "nodes", "skin")
    assert granted.status_code == 201
    expires = datetime.fromisoformat(granted.json()["expires_at"])
    assert timedelta(hours=3, minutes=59) < expires - datetime.now(UTC) <= timedelta(hours=4)
    assert opens(api, lab, "nodes", "skin")[0] == 200
    other = (
        api(lab.people["head"])
        .post(
            "/api/cases",
            json={
                "patient": {"name": "Other"},
                "specimens": [{"letter": "A"}],
                "folder_id": lab.folders["Skin"],
            },
        )
        .json()["id"]
    )
    assert api(lab.people["nodes"]).get(f"/api/cases/{other}").status_code == 403


def test_the_audit_entry_carries_the_reason(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    ask(api, lab, "nodes", "skin")
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{lab.cases['skin']}' AND action = 'case.emergency-access'",
    )
    assert details == [(f'{{"hours":4,"reason":"{REASON}","role":"consultant"}}',)]


def test_a_grant_expires(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    ask(api, lab, "nodes", "skin")
    owner(
        database,
        "UPDATE emergency_grants SET expires_at = now() - interval '1 second' "
        f"WHERE case_id = '{lab.cases['skin']}'",
    )
    assert opens(api, lab, "nodes", "skin") == (403, "outside-folders")


@pytest.mark.parametrize("reason", ["", "   ", "too short", "x" * 501])
def test_a_reason_is_required(api: ApiAs, database: str, reason: str) -> None:
    lab = make_lab(api, database)
    assert ask(api, lab, "nodes", "skin", reason).status_code == 422
    assert opens(api, lab, "nodes", "skin")[0] == 403


def test_an_administrator_reads_a_patient_only_with_a_reason(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    admin = person(database, lab.tenant_id, "admin", Role.ADMIN)
    lab.people["admin"] = admin
    assert opens(api, lab, "admin", "unfiled") == (403, "emergency-access-needed")
    assert api(admin).get("/api/cases").status_code == 403
    assert ask(api, lab, "admin", "unfiled").status_code == 201
    body = api(admin).get(f"/api/cases/{lab.cases['unfiled']}").json()
    assert body["patient"]["name"] == "Patient unfiled"
    assert opens(api, lab, "admin", "nodes") == (403, "emergency-access-needed")


def test_who_may_ask_and_who_needs_not(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    assert ask(api, lab, "lab", "skin").status_code == 403
    assert opens(api, lab, "lead", "skin")[0] == 200


def test_the_lab_sets_how_long_a_grant_lasts(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    policy = {"idle_lock_minutes": 15, "session_hours": 12, "emergency_hours": 1}
    assert api(lab.people["head"]).put("/api/tenant/session-policy", json=policy).status_code == 200
    expires = datetime.fromisoformat(ask(api, lab, "nodes", "skin").json()["expires_at"])
    assert expires - datetime.now(UTC) <= timedelta(hours=1)
