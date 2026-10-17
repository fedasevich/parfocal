import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from db_support import ApiAs
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncConnection
from workspace_support import Workspace, make_workspace, owner

from parfocal_api import case_creation
from parfocal_api.case_creation import CaseDefaults, CaseDraft
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

CASES = "/api/cases"


PEOPLE = {
    "researcher": Role.RESEARCHER,
    "colleague": Role.RESEARCHER,
    "reviewer": Role.REVIEWER,
    "second_reviewer": Role.REVIEWER,
    "admin": Role.ADMIN,
}


def make_lab(database: str) -> Workspace:
    return make_workspace(database, PEOPLE)


def draft(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "patient": {
            "name": "Eva Testová",
            "mrn": f"MRN-{uuid.uuid4().hex[:8]}",
            "birth_date": "1970-01-02",
            "sex": "female",
        },
        "accession": f"S26-{uuid.uuid4().hex[:6].upper()}",
        "specimens": [
            {
                "letter": "A",
                "type": "Lymph node",
                "laterality": "left",
                "blocks": [{"number": 1, "stains": ["H&E", "CK"], "levels": 3}],
            },
            {"letter": "B", "type": "Breast", "blocks": [{"number": 1}, {"number": 2}]},
        ],
        "clinical_note": "Lump in the left breast",
        "clinical_question": "Metastasis?",
        "requester": "MUDr. Requester",
        "priority": "urgent",
    }
    return body | changes


def create(api: ApiAs, who: MemberPrincipal, body: dict[str, Any], key: str | None = None) -> Any:
    headers = {"Idempotency-Key": key} if key else {}
    return api(who).post(CASES, json=body, headers=headers)


def test_a_lead_creates_a_case_with_a_new_patient(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    response = create(api, lab.people["researcher"], draft())
    assert response.status_code == 201, response.text
    case = response.json()
    assert (case["source"], case["priority"]) == (
        "manual",
        "urgent",
    )
    assert (case["patient"]["name"], case["patient"]["sex"]) == ("Eva Testová", "female")
    assert case["clinical_note"] == "Lump in the left breast"
    assert [s["letter"] for s in case["specimens"]] == ["A", "B"]
    first_block = case["specimens"][0]["blocks"][0]
    assert (first_block["stains"], first_block["levels"]) == (["H&E", "CK"], 3)
    assert [len(s["blocks"]) for s in case["specimens"]] == [1, 2]
    assert (case["service"], case["due_at"], case["assignee_user_id"]) == (None, None, None)
    details = owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{case['id']}'",
    )
    assert details == [
        (
            "case.created",
            '{"draft":false,"new_patient":true,"priority":"urgent","source":"manual","specimens":2}',
        )
    ]


def test_a_case_for_an_existing_patient(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people["colleague"], draft()).json()
    body = draft(patient=None, patient_id=first["patient"]["id"])
    second = create(api, lab.people["colleague"], body).json()
    assert second["patient"]["id"] == first["patient"]["id"]
    missing = create(
        api, lab.people["colleague"], draft(patient=None, patient_id=str(uuid.uuid4()))
    )
    assert missing.status_code == 404
    same_mrn = draft(patient={"name": "Someone", "mrn": first["patient"]["mrn"].lower()})
    duplicate = create(api, lab.people["colleague"], same_mrn)
    assert (duplicate.status_code, duplicate.json()["code"]) == (409, "patient-exists")


class FixedRules:
    def __init__(self, defaults: CaseDefaults) -> None:
        self.defaults = defaults

    async def defaults_for(
        self, connection: AsyncConnection, tenant_id: uuid.UUID, draft: CaseDraft
    ) -> CaseDefaults:
        return self.defaults


def test_lab_rules_fill_defaults_and_the_form_overrides_them(
    api: ApiAs, database: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    lab = make_lab(database)
    first_reviewer = lab.people["reviewer"].user_id
    second_reviewer = lab.people["second_reviewer"].user_id
    rules = FixedRules(
        CaseDefaults(
            service="Lymph nodes",
            due_at=datetime(2026, 10, 20, 12, tzinfo=UTC),
            assignee_user_id=first_reviewer,
        )
    )
    monkeypatch.setattr(case_creation, "RULES", rules)
    defaulted = create(api, lab.people["researcher"], draft()).json()
    assert (defaulted["service"], defaulted["due_at"], defaulted["assignee_user_id"]) == (
        "Lymph nodes",
        "2026-10-20T12:00:00Z",
        str(first_reviewer),
    )
    overridden = create(
        api,
        lab.people["researcher"],
        draft(
            service="Breast", due_at="2026-10-16T09:00:00Z", assignee_user_id=str(second_reviewer)
        ),
    ).json()
    assert (overridden["service"], overridden["due_at"], overridden["assignee_user_id"]) == (
        "Breast",
        "2026-10-16T09:00:00Z",
        str(second_reviewer),
    )
    stranger = create(api, lab.people["researcher"], draft(assignee_user_id=str(uuid.uuid4())))
    assert (stranger.status_code, stranger.json()["code"]) == (400, "assignee-not-member")


def test_a_draft_is_seen_only_by_its_author(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    case = create(api, lab.people["researcher"], draft(draft=True)).json()
    assert case["is_draft"] is True
    path = f"{CASES}/{case['id']}"
    assert api(lab.people["researcher"]).get(path).status_code == 200
    assert api(lab.people["colleague"]).get(path).status_code == 404
    listed = api(lab.people["colleague"]).get(CASES).json()
    assert case["id"] not in {row["id"] for row in listed}


def test_repeating_a_request_returns_the_same_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people["colleague"], draft(), key="form-1")
    again = create(api, lab.people["colleague"], draft(), key="form-1")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    other_person = create(api, lab.people["researcher"], draft(), key="form-1")
    assert other_person.json()["id"] != first.json()["id"]
    count = owner(database, f"SELECT count(*) FROM cases WHERE tenant_id = '{lab.tenant_id}'")
    assert count == [(2,)]


def test_concurrent_repeats_create_one_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    client: TestClient = api(lab.people["colleague"])

    async def burst() -> list[int]:
        def send() -> int:
            return client.post(
                CASES, json=draft(), headers={"Idempotency-Key": "burst"}
            ).status_code

        return list(await asyncio.gather(*(asyncio.to_thread(send) for _ in range(5))))

    statuses = asyncio.run(burst())
    assert sorted(statuses) == [200, 200, 200, 200, 201]
    count = owner(database, f"SELECT count(*) FROM cases WHERE tenant_id = '{lab.tenant_id}'")
    assert count == [(1,)]


def test_a_typed_case_id_is_unique_within_the_workspace(api: ApiAs, database: str) -> None:
    lab, other = make_lab(database), make_lab(database)
    first = create(api, lab.people["colleague"], draft(accession="  Batch 7 / 12 "))
    assert first.json()["accession"] == "Batch 7 / 12"
    again = create(api, lab.people["colleague"], draft(accession="Batch 7 / 12"))
    assert (again.status_code, again.json()["code"]) == (409, "accession-taken")
    elsewhere = create(api, other.people["researcher"], draft(accession="Batch 7 / 12"))
    assert elsewhere.status_code == 201, elsewhere.text


@pytest.mark.parametrize(
    "changes",
    [
        {"patient_id": str(uuid.uuid4())},
        {"patient": None},
        {"specimens": []},
        {"specimens": [{"letter": "A"}, {"letter": "A"}]},
        {"specimens": [{"letter": "a"}]},
        {"specimens": [{"letter": "A", "blocks": [{"number": 1}, {"number": 1}]}]},
        {"priority": "whenever"},
        {"accession": None},
        {"accession": "   "},
        {"accession": "x" * 41},
    ],
)
def test_invalid_drafts_are_refused(api: ApiAs, database: str, changes: dict[str, Any]) -> None:
    lab = make_lab(database)
    assert create(api, lab.people["researcher"], draft(**changes)).status_code == 422


def test_reviewers_and_admins_do_not_create_cases(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    for label in ("reviewer", "admin"):
        assert create(api, lab.people[label], draft()).status_code == 403
