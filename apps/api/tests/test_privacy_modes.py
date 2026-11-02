import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_case_creation import Lab, create, draft, make_lab
from workspace_support import join_project, make_project, owner

pytestmark = pytest.mark.db

REASON = "The ethics board approved identified data for this study"


def privacy(api: ApiAs, lab: Lab, who: str, project: uuid.UUID, body: dict[str, Any]) -> Any:
    return api(lab.people[who]).post(f"/api/projects/{project}/privacy-mode", json=body)


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def privacy_entries(database: str, project: uuid.UUID) -> list[dict[str, str]]:
    rows = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{project}' AND action = 'project.privacy-changed' ORDER BY seq",
    )
    return [json.loads(str(row[0])) for row in rows]


def test_switching_to_clinical_needs_an_owner_with_admin_rights_and_a_reason(
    api: ApiAs, database: str
) -> None:
    lab = make_lab(database)
    project = lab.de_identified
    clinical = {"privacy_mode": "clinical", "reason": REASON}
    assert problem(privacy(api, lab, "researcher", project, clinical)) == (403, "forbidden")
    assert privacy(api, lab, "admin", project, clinical).status_code == 404
    join_project(database, project, lab.people["admin"], "owner")
    for body in ({"privacy_mode": "clinical"}, {"privacy_mode": "clinical", "reason": "why"}):
        assert privacy(api, lab, "admin", project, body).status_code == 422
    changed = privacy(api, lab, "admin", project, clinical)
    assert changed.status_code == 200, changed.text
    assert changed.json()["privacy_mode"] == "clinical"
    assert privacy_entries(database, project) == [
        {"from": "de-identified", "to": "clinical", "reason": REASON}
    ]
    again = privacy(api, lab, "admin", project, clinical)
    assert again.status_code == 200
    assert len(privacy_entries(database, project)) == 1
    with_patient = create(api, lab.people["researcher"], draft(lab, project_id=str(project)))
    assert with_patient.status_code == 201, with_patient.text


def test_a_project_holding_patients_cannot_become_de_identified(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    join_project(database, lab.clinical, lab.people["admin"], "owner")
    assert create(api, lab.people["researcher"], draft(lab)).status_code == 201
    back = {"privacy_mode": "de-identified", "reason": REASON}
    assert problem(privacy(api, lab, "admin", lab.clinical, back)) == (
        409,
        "project-holds-patients",
    )
    empty = make_project(database, lab.tenant_id, "clinical")
    join_project(database, empty, lab.people["admin"], "owner")
    switched = privacy(api, lab, "admin", empty, back)
    assert (switched.status_code, switched.json()["privacy_mode"]) == (200, "de-identified")


def test_reading_a_patient_in_a_clinical_case_is_audited(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    case = create(api, lab.people["researcher"], draft(lab)).json()
    read = api(lab.people["colleague"]).get(f"/api/cases/{case['id']}").json()
    assert read["patient"]["name"] == "Eva Testová"
    rows = owner(
        database,
        "SELECT count(*) FROM audit_events "
        f"WHERE target_id = '{case['id']}' AND action = 'case.patient-viewed'",
    )
    assert rows == [(1,)]
    trail = api(lab.people["admin"]).get(
        "/api/tenant/audit-events", params={"patient_id": case["patient"]["id"]}
    )
    assert trail.status_code == 200, trail.text
    assert "case.patient-viewed" in {event["action"] for event in trail.json()}


def test_no_patient_field_leaves_a_de_identified_project(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    body = draft(lab, project_id=str(lab.de_identified))
    body.pop("patient")
    case = create(api, lab.people["researcher"], body)
    assert case.status_code == 201, case.text
    read = api(lab.people["colleague"]).get(f"/api/cases/{case.json()['id']}").json()
    assert read["patient"] is None
    rows = owner(
        database,
        "SELECT count(*) FROM audit_events "
        f"WHERE target_id = '{case.json()['id']}' AND action = 'case.patient-viewed'",
    )
    assert rows == [(0,)]
