import logging
import uuid

import pytest
from case_support import seed_project
from db_support import ApiAs
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection
from test_slide_details import project_person, run, seeded
from workspace_support import join_project, make_tenant, owner

from parfocal_api.tables import PrivacyMode, Role, cases

pytestmark = pytest.mark.db

NOTE = "Fake note for a test. Lesion growing over three months."


def note_path(case_id: object) -> str:
    return f"/api/cases/{case_id}/clinical-note"


def sealed_of(database: str, case_id: object) -> object:
    rows = owner(database, f"SELECT clinical_note_ciphertext FROM cases WHERE id = '{case_id}'")
    return rows[0][0]


def note_audit(database: str, case_id: object) -> list[tuple[object, ...]]:
    return owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{case_id}' "
        "AND action = 'case.clinical-note-changed' ORDER BY occurred_at",
    )


def de_identified_case(database: str, tenant_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    async def work(connection: AsyncConnection) -> tuple[uuid.UUID, uuid.UUID]:
        project_id = await seed_project(connection, tenant_id, PrivacyMode.DE_IDENTIFIED)
        case_id = uuid.uuid4()
        await connection.execute(
            insert(cases).values(
                id=case_id,
                tenant_id=tenant_id,
                project_id=project_id,
                label=f"T-{uuid.uuid4().hex[:6]}",
                source="manual",
            )
        )
        return project_id, case_id

    return run(database, tenant_id, work)


def test_an_owner_writes_reads_and_clears_the_note(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    written = api(who).put(note_path(case.case_id), json={"note": f"  {NOTE}  "})
    assert written.status_code == 200, written.text
    assert written.json()["clinical_note"] == NOTE
    assert api(who).get(f"/api/cases/{case.case_id}").json()["clinical_note"] == NOTE
    cleared = api(who).put(note_path(case.case_id), json={"note": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["clinical_note"] is None
    assert sealed_of(database, case.case_id) is None
    api(who).put(note_path(case.case_id), json={"note": NOTE})
    emptied = api(who).put(note_path(case.case_id), json={"note": "   "})
    assert emptied.json()["clinical_note"] is None


def test_the_note_is_stored_sealed(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    api(who).put(note_path(case.case_id), json={"note": NOTE})
    sealed = sealed_of(database, case.case_id)
    assert isinstance(sealed, bytes)
    assert NOTE.encode() not in sealed
    assert b"Lesion" not in sealed


def test_a_case_without_a_note_reads_none(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    assert api(who).get(f"/api/cases/{case.case_id}").json()["clinical_note"] is None


def test_the_audit_entry_holds_no_note_text(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    api(who).put(note_path(case.case_id), json={"note": NOTE})
    api(who).put(note_path(case.case_id), json={"note": None})
    api(who).put(note_path(case.case_id), json={"note": None})
    entries = note_audit(database, case.case_id)
    assert entries == [
        ("case.clinical-note-changed", '{"cleared":false}'),
        ("case.clinical-note-changed", '{"cleared":true}'),
    ]
    every = owner(database, "SELECT details::text FROM audit_events")
    assert all("Lesion" not in str(details) for (details,) in every)


def test_the_note_text_never_reaches_a_log(
    api: ApiAs, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    assert api(who).put(note_path(case.case_id), json={"note": NOTE}).status_code == 200
    assert api(who).get(f"/api/cases/{case.case_id}").status_code == 200
    too_long = api(who).put(note_path(case.case_id), json={"note": f"{NOTE} " + "x" * 4000})
    assert too_long.status_code == 422
    assert "Lesion" not in too_long.text
    assert "Lesion" not in caplog.text


def test_a_de_identified_project_refuses_the_note(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    project_id, case_id = de_identified_case(database, tenant)
    who = project_person(database, case, tenant, "owner")
    join_project(database, project_id, who, "owner")
    response = api(who).put(note_path(case_id), json={"note": NOTE})
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "de-identified-project"
    assert sealed_of(database, case_id) is None
    assert note_audit(database, case_id) == []


def test_viewers_and_reviewers_write_no_note(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    viewer = project_person(database, case, tenant, "viewer")
    reviewer = project_person(database, case, tenant, "reviewer", Role.REVIEWER)
    for who in (viewer, reviewer):
        response = api(who).put(note_path(case.case_id), json={"note": NOTE})
        assert response.status_code == 403, response.text
    assert sealed_of(database, case.case_id) is None


def test_another_tenant_neither_writes_nor_reads_the_note(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    api(who).put(note_path(case.case_id), json={"note": NOTE})
    other_tenant = make_tenant(database)
    other_case = seeded(database, other_tenant)
    stranger = project_person(database, other_case, other_tenant, "owner")
    written = api(stranger).put(note_path(case.case_id), json={"note": "Fake overwrite"})
    assert written.status_code == 404, written.text
    read = api(stranger).get(f"/api/cases/{case.case_id}")
    assert read.status_code == 404, read.text
    assert "Lesion" not in read.text
    assert api(who).get(f"/api/cases/{case.case_id}").json()["clinical_note"] == NOTE
