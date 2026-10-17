import asyncio
import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from fastapi.testclient import TestClient
from workspace_support import Workspace, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

CASES = "/api/cases"


PEOPLE = {
    "researcher": Role.RESEARCHER,
    "colleague": Role.RESEARCHER,
    "reviewer": Role.REVIEWER,
    "admin": Role.ADMIN,
}


@dataclass(frozen=True)
class Lab:
    workspace: Workspace
    clinical: uuid.UUID
    de_identified: uuid.UUID

    @property
    def people(self) -> dict[str, MemberPrincipal]:
        return self.workspace.people

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.workspace.tenant_id


def make_lab(database: str) -> Lab:
    workspace = make_workspace(database, PEOPLE)
    return Lab(
        workspace,
        make_project(database, workspace.tenant_id, "clinical"),
        make_project(database, workspace.tenant_id, "de-identified"),
    )


def draft(lab: Lab, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "project_id": str(lab.clinical),
        "label": f"S26-{uuid.uuid4().hex[:6].upper()}",
        "patient": {
            "name": "Eva Testová",
            "mrn": f"MRN-{uuid.uuid4().hex[:8]}",
            "birth_date": "1970-01-02",
            "sex": "female",
        },
        "specimens": [
            {
                "letter": "A",
                "type": "Lymph node",
                "laterality": "left",
                "blocks": [{"number": 1, "stains": ["H&E", "CK"], "levels": 3}],
            },
            {"letter": "B", "type": "Breast", "blocks": [{"number": 1}, {"number": 2}]},
        ],
    }
    return body | changes


def create(api: ApiAs, who: MemberPrincipal, body: dict[str, Any], key: str | None = None) -> Any:
    headers = {"Idempotency-Key": key} if key else {}
    return api(who).post(CASES, json=body, headers=headers)


def test_a_researcher_creates_a_case_with_a_new_patient_in_a_clinical_project(
    api: ApiAs, database: str
) -> None:
    lab = make_lab(database)
    response = create(api, lab.people["researcher"], draft(lab))
    assert response.status_code == 201, response.text
    case = response.json()
    assert (case["project_id"], case["source"]) == (str(lab.clinical), "manual")
    assert (case["patient"]["name"], case["patient"]["sex"]) == ("Eva Testová", "female")
    assert [s["letter"] for s in case["specimens"]] == ["A", "B"]
    first_block = case["specimens"][0]["blocks"][0]
    assert (first_block["stains"], first_block["levels"]) == (["H&E", "CK"], 3)
    assert [len(s["blocks"]) for s in case["specimens"]] == [1, 2]
    details = owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{case['id']}'",
    )
    assert details == [
        (
            "case.created",
            '{"new_patient":true,"privacy_mode":"clinical","source":"manual","specimens":2}',
        )
    ]


def test_a_case_without_a_patient_works_in_both_privacy_modes(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    for project in (lab.clinical, lab.de_identified):
        response = create(
            api, lab.people["researcher"], draft(lab, project_id=str(project), patient=None)
        )
        assert response.status_code == 201, response.text
        assert (response.json()["project_id"], response.json()["patient"]) == (str(project), None)


def test_a_de_identified_project_refuses_patient_data(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    existing = create(api, lab.people["researcher"], draft(lab)).json()["patient"]["id"]
    for patient in ({"patient": {"name": "Hidden"}}, {"patient": None, "patient_id": existing}):
        response = create(
            api, lab.people["researcher"], draft(lab, project_id=str(lab.de_identified), **patient)
        )
        assert (response.status_code, response.json()["code"]) == (400, "de-identified-project")
    count = owner(database, f"SELECT count(*) FROM cases WHERE project_id = '{lab.de_identified}'")
    assert count == [(0,)]


def test_a_case_needs_only_a_project_and_an_id(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    body = {"project_id": str(lab.de_identified), "label": "tcga-0042"}
    response = create(api, lab.people["researcher"], body)
    assert response.status_code == 201, response.text
    case = response.json()
    assert (case["label"], case["patient"], case["specimens"], case["slides"]) == (
        "tcga-0042",
        None,
        [],
        [],
    )
    assert {"is_draft", "service"}.isdisjoint(case)


def test_a_case_needs_a_project_of_this_workspace(api: ApiAs, database: str) -> None:
    lab, other = make_lab(database), make_lab(database)
    for project in (other.clinical, uuid.uuid4()):
        response = create(api, lab.people["researcher"], draft(lab, project_id=str(project)))
        assert response.status_code == 404


def test_a_case_for_an_existing_patient(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people["colleague"], draft(lab)).json()
    body = draft(lab, patient=None, patient_id=first["patient"]["id"])
    second = create(api, lab.people["colleague"], body).json()
    assert second["patient"]["id"] == first["patient"]["id"]
    missing = create(
        api, lab.people["colleague"], draft(lab, patient=None, patient_id=str(uuid.uuid4()))
    )
    assert missing.status_code == 404
    same_mrn = draft(lab, patient={"name": "Someone", "mrn": first["patient"]["mrn"].lower()})
    duplicate = create(api, lab.people["colleague"], same_mrn)
    assert (duplicate.status_code, duplicate.json()["code"]) == (409, "patient-exists")


def test_repeating_a_request_returns_the_same_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people["colleague"], draft(lab), key="form-1")
    again = create(api, lab.people["colleague"], draft(lab), key="form-1")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    other_person = create(api, lab.people["researcher"], draft(lab), key="form-1")
    assert other_person.json()["id"] != first.json()["id"]
    count = owner(database, f"SELECT count(*) FROM cases WHERE tenant_id = '{lab.tenant_id}'")
    assert count == [(2,)]


def test_concurrent_repeats_create_one_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    client: TestClient = api(lab.people["colleague"])

    async def burst() -> list[int]:
        def send() -> int:
            return client.post(
                CASES, json=draft(lab), headers={"Idempotency-Key": "burst"}
            ).status_code

        return list(await asyncio.gather(*(asyncio.to_thread(send) for _ in range(5))))

    statuses = asyncio.run(burst())
    assert sorted(statuses) == [200, 200, 200, 200, 201]
    count = owner(database, f"SELECT count(*) FROM cases WHERE tenant_id = '{lab.tenant_id}'")
    assert count == [(1,)]


def test_a_case_id_is_unique_within_its_project(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people["colleague"], draft(lab, label="  Batch 7 / 12 "))
    assert first.json()["label"] == "Batch 7 / 12"
    again = create(api, lab.people["colleague"], draft(lab, label="Batch 7 / 12"))
    assert (again.status_code, again.json()["code"]) == (409, "case-label-taken")
    elsewhere = create(
        api,
        lab.people["colleague"],
        draft(lab, label="Batch 7 / 12", project_id=str(lab.de_identified), patient=None),
    )
    assert elsewhere.status_code == 201, elsewhere.text


@pytest.mark.parametrize(
    "changes",
    [
        {"patient_id": str(uuid.uuid4())},
        {"project_id": None},
        {"specimens": [{"letter": "A"}, {"letter": "A"}]},
        {"specimens": [{"letter": "a"}]},
        {"specimens": [{"letter": "A", "blocks": [{"number": 1}, {"number": 1}]}]},
        {"label": None},
        {"label": "   "},
        {"label": "x" * 101},
    ],
)
def test_invalid_drafts_are_refused(api: ApiAs, database: str, changes: dict[str, Any]) -> None:
    lab = make_lab(database)
    assert create(api, lab.people["researcher"], draft(lab, **changes)).status_code == 422


def test_reviewers_and_admins_do_not_create_cases(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    for label in ("reviewer", "admin"):
        assert create(api, lab.people[label], draft(lab)).status_code == 403
