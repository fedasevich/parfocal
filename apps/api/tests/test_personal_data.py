import asyncio
import uuid
from typing import Any

import pytest
from case_support import seed_case
from db_support import APP_URL, ApiAs, with_database
from test_my_work import task
from test_review_tasks import Study, study
from workspace_support import join_project, owner

from parfocal_api.personal_data import EXPORTED_ELSEWHERE, NOT_EXPORTED, person_columns
from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_common.data_classes import PERSONAL
from parfocal_common.db import (
    DatabaseScope,
    async_database_url,
    create_engine,
    metadata,
    scoped_transaction,
)

OPERATOR = PlatformOperator("erasure-operator")


def judge(database: str, s: Study, task_id: str, who: str, number: int) -> None:
    owner(
        database,
        "INSERT INTO verdicts (tenant_id, project_id, task_id, slide_id, user_id, kind, number, "
        f"value) VALUES ('{s.tenant_id}', '{s.project}', '{task_id}', '{s.slides[0]}', "
        f"'{s.people[who].user_id}', 'region', {number}, 'agree')",
    )


def export(api: ApiAs, who: MemberPrincipal) -> dict[str, Any]:
    response = api(who).get("/api/me/personal-data")
    assert response.status_code == 200, response.text
    return response.json()


def test_every_personal_column_is_exported_or_has_a_reason() -> None:
    tables = {
        table.name
        for table in metadata.sorted_tables
        if any(column.info is PERSONAL for column in table.c)
    }
    handled = set(person_columns()) | {"invitations"} | set(EXPORTED_ELSEWHERE) | set(NOT_EXPORTED)
    assert tables - handled == set()
    assert {"verdicts", "opinions", "review_edits", "annotations"} <= set(person_columns())


@pytest.mark.db
def test_a_person_exports_their_own_data_and_nobody_elses(api: ApiAs, database: str) -> None:
    s = study(database)
    round_one = task(
        api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first"), s.user("second")]
    )
    judge(database, s, round_one["id"], "first", 1)
    judge(database, s, round_one["id"], "second", 2)
    data = export(api, s.people["first"])
    assert data["profile"]["id"] == s.user("first")
    [workspace] = data["workspaces"]
    assert workspace["tenant_id"] == str(s.tenant_id)
    records = workspace["records"]
    assert [row["number"] for row in records["verdicts"]] == [1]
    assert {row["user_id"] for row in records["review_assignments"]} == {s.user("first")}
    assert [row["role"] for row in records["project_members"]] == ["reviewer"]
    assert records["memberships"][0]["role"] == "reviewer"
    assert "review_tasks" not in records
    assert (
        export(api, s.people["owner"])["workspaces"][0]["records"]["review_tasks"][0]["name"]
        == "Round 1"
    )
    assert owner(
        database,
        "SELECT count(*) FROM audit_events "
        f"WHERE tenant_id = '{s.tenant_id}' AND action = 'person.data-exported'",
    ) == [(2,)]


@pytest.mark.db
def test_an_erased_person_keeps_their_work_under_a_former_member(api: ApiAs, database: str) -> None:
    s = study(database)
    round_one = task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    judge(database, s, round_one["id"], "first", 1)
    first = s.people["first"]
    owner(
        database,
        "INSERT INTO sessions (id_hash, subject, tokens, access_expires_at, expires_at) "
        f"VALUES (decode(md5(random()::text), 'hex'), '{first.subject}', '\\x00', "
        "now() + interval '1 hour', now() + interval '1 day')",
    )
    owner(database, f"INSERT INTO audit_people (subject) VALUES ('{first.subject}')")
    erased = api(OPERATOR).post(f"/api/platform/users/{first.user_id}/erase")
    assert erased.status_code == 200, erased.text
    assert erased.json() == {
        "user_id": str(first.user_id),
        "sessions_ended": 1,
        "memberships_removed": 0,
        "memberships_kept": 1,
    }
    [(name, initials, email, subject)] = owner(
        database,
        f"SELECT display_name, initials, email, subject FROM users WHERE id = '{first.user_id}'",
    )
    assert (name, initials, email) == ("Former member", "FM", None)
    assert str(subject).startswith("erased:")
    assert owner(
        database, f"SELECT count(*) FROM audit_people WHERE subject = '{first.subject}'"
    ) == [(0,)]
    assert owner(database, f"SELECT count(*) FROM verdicts WHERE user_id = '{first.user_id}'") == [
        (1,)
    ]
    third = s.people["third"]
    assert (
        api(OPERATOR)
        .post(f"/api/platform/users/{third.user_id}/erase")
        .json()["memberships_removed"]
        == 1
    )
    missing = api(OPERATOR).post(f"/api/platform/users/{uuid.uuid4()}/erase")
    assert (missing.status_code, missing.json()["code"]) == (404, "person-not-found")
    assert (
        api(s.people["admin"]).post(f"/api/platform/users/{third.user_id}/erase").status_code == 403
    )


def seeded_patient(database: str, s: Study) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    async def go() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=s.tenant_id)
            ) as connection:
                case = await seed_case(connection, s.tenant_id)
                return case.project_id, case.patient_id, case.case_id
        finally:
            await engine.dispose()

    return asyncio.run(go())


@pytest.mark.db
def test_a_project_owner_exports_and_erases_a_patient_and_the_case_stays(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    project, patient, case = seeded_patient(database, s)
    join_project(database, project, s.people["owner"], "owner")
    join_project(database, project, s.people["viewer"], "viewer")
    base = f"/api/projects/{project}/patients/{patient}"
    exported = api(s.people["owner"]).get(f"{base}/personal-data")
    assert exported.status_code == 200, exported.text
    body = exported.json()
    assert (body["name"], body["birth_date"]) == ("Eva Testová", "1970-01-02")
    assert [row["id"] for row in body["cases"]] == [str(case)]
    assert len(body["slides"]) == 2
    viewer = api(s.people["viewer"]).get(f"{base}/personal-data")
    assert (viewer.status_code, viewer.json()["code"]) == (403, "owners-handle-patient-requests")
    hold = api(s.people["admin"]).post(
        "/api/tenant/legal-holds", json={"project_id": str(project), "reason": "Claim"}
    )
    held = api(s.people["owner"]).delete(base)
    assert (held.status_code, held.json()["code"]) == (409, "legal-hold")
    api(s.people["admin"]).post(f"/api/tenant/legal-holds/{hold.json()['id']}/release")
    erased = api(s.people["owner"]).delete(base)
    assert erased.status_code == 200, erased.text
    assert erased.json() == {"patient_id": str(patient), "cases_unlinked": 1}
    assert owner(database, f"SELECT count(*) FROM patients WHERE id = '{patient}'") == [(0,)]
    assert owner(database, f"SELECT patient_id FROM cases WHERE id = '{case}'") == [(None,)]
    gone = api(s.people["owner"]).get(f"{base}/personal-data")
    assert (gone.status_code, gone.json()["code"]) == (404, "patient-not-found")
    audit = owner(
        database,
        "SELECT action, details FROM audit_events WHERE tenant_id = "
        f"'{s.tenant_id}' AND target_id = '{patient}' ORDER BY seq",
    )
    assert [row[0] for row in audit] == ["patient.data-exported", "patient.erased"]
    assert "Eva" not in str(audit)
