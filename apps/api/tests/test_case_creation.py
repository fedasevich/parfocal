import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from db_support import OWNER_URL, ApiAs, query, with_database
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api import case_creation
from parfocal_api.case_creation import CaseDefaults, CaseDraft
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

CASES = "/api/cases"


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    people: dict[Role, MemberPrincipal]


def owner(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def make_lab(database: str) -> Lab:
    slug = f"new-{uuid.uuid4().hex[:10]}"
    tenant_id = uuid.UUID(
        str(
            owner(
                database,
                "WITH organisation AS (INSERT INTO organisations (slug, name) "
                f"VALUES ('{slug}', '{slug}') RETURNING id) "
                "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
                f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
                "RETURNING id",
            )[0][0]
        )
    )
    people: dict[Role, MemberPrincipal] = {}
    for role in (Role.LEAD, Role.LAB, Role.CONSULTANT, Role.RESIDENT, Role.ADMIN):
        subject = f"{slug}-{role}"
        user_id = uuid.UUID(
            str(
                owner(
                    database,
                    "INSERT INTO users (subject, display_name, initials, avatar_colour) "
                    f"VALUES ('{subject}', '{role}', 'PP', 1) RETURNING id",
                )[0][0]
            )
        )
        owner(
            database,
            "INSERT INTO memberships (tenant_id, user_id, role) "
            f"VALUES ('{tenant_id}', '{user_id}', '{role}')",
        )
        people[role] = MemberPrincipal(subject, tenant_id, user_id, role)
    return Lab(tenant_id, people)


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
    response = create(api, lab.people[Role.LEAD], draft())
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
    first = create(api, lab.people[Role.LAB], draft()).json()
    body = draft(patient=None, patient_id=first["patient"]["id"])
    second = create(api, lab.people[Role.LAB], body).json()
    assert second["patient"]["id"] == first["patient"]["id"]
    missing = create(api, lab.people[Role.LAB], draft(patient=None, patient_id=str(uuid.uuid4())))
    assert missing.status_code == 404
    same_mrn = draft(patient={"name": "Someone", "mrn": first["patient"]["mrn"].lower()})
    duplicate = create(api, lab.people[Role.LAB], same_mrn)
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
    consultant = lab.people[Role.CONSULTANT].user_id
    resident = lab.people[Role.RESIDENT].user_id
    rules = FixedRules(
        CaseDefaults(
            service="Lymph nodes",
            due_at=datetime(2026, 10, 20, 12, tzinfo=UTC),
            assignee_user_id=consultant,
        )
    )
    monkeypatch.setattr(case_creation, "RULES", rules)
    defaulted = create(api, lab.people[Role.LEAD], draft()).json()
    assert (defaulted["service"], defaulted["due_at"], defaulted["assignee_user_id"]) == (
        "Lymph nodes",
        "2026-10-20T12:00:00Z",
        str(consultant),
    )
    overridden = create(
        api,
        lab.people[Role.LEAD],
        draft(service="Breast", due_at="2026-10-16T09:00:00Z", assignee_user_id=str(resident)),
    ).json()
    assert (overridden["service"], overridden["due_at"], overridden["assignee_user_id"]) == (
        "Breast",
        "2026-10-16T09:00:00Z",
        str(resident),
    )
    stranger = create(api, lab.people[Role.LEAD], draft(assignee_user_id=str(uuid.uuid4())))
    assert (stranger.status_code, stranger.json()["code"]) == (400, "assignee-not-member")


def test_a_draft_is_seen_only_by_its_author_and_the_lab(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    case = create(api, lab.people[Role.CONSULTANT], draft(draft=True)).json()
    assert case["is_draft"] is True
    path = f"{CASES}/{case['id']}"
    assert api(lab.people[Role.CONSULTANT]).get(path).status_code == 200
    assert api(lab.people[Role.LAB]).get(path).status_code == 200
    assert api(lab.people[Role.LEAD]).get(path).status_code == 404


def test_repeating_a_request_returns_the_same_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    first = create(api, lab.people[Role.LAB], draft(), key="form-1")
    again = create(api, lab.people[Role.LAB], draft(), key="form-1")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    other_person = create(api, lab.people[Role.LEAD], draft(), key="form-1")
    assert other_person.json()["id"] != first.json()["id"]
    count = owner(database, f"SELECT count(*) FROM cases WHERE tenant_id = '{lab.tenant_id}'")
    assert count == [(2,)]


def test_concurrent_repeats_create_one_case(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    client: TestClient = api(lab.people[Role.LAB])

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
    first = create(api, lab.people[Role.LAB], draft(accession="  Batch 7 / 12 "))
    assert first.json()["accession"] == "Batch 7 / 12"
    again = create(api, lab.people[Role.LAB], draft(accession="Batch 7 / 12"))
    assert (again.status_code, again.json()["code"]) == (409, "accession-taken")
    elsewhere = create(api, other.people[Role.LAB], draft(accession="Batch 7 / 12"))
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
    assert create(api, lab.people[Role.LEAD], draft(**changes)).status_code == 422


def test_residents_and_admins_do_not_create_cases(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    for role in (Role.RESIDENT, Role.ADMIN):
        assert create(api, lab.people[role], draft()).status_code == 403
