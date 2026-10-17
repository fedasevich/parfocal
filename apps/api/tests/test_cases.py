import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from case_support import NOTE, QUESTION, SeededCase, seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.principals import GuestGrant, GuestPrincipal, MemberPrincipal
from parfocal_api.tables import Role, blocks, cases, specimens
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db


def make_tenant(database: str) -> uuid.UUID:
    slug = f"case-{uuid.uuid4().hex[:10]}"
    rows = query(
        with_database(OWNER_URL, database),
        "WITH organisation AS (INSERT INTO organisations (slug, name) "
        f"VALUES ('{slug}', '{slug}') RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
        "RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def run[T](
    database: str, scope: DatabaseScope, work: Callable[[AsyncConnection], Awaitable[T]]
) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, scope) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def seeded(database: str, tenant_id: uuid.UUID) -> SeededCase:
    async def work(connection: AsyncConnection) -> SeededCase:
        return await seed_case(connection, tenant_id)

    return run(database, DatabaseScope(tenant_id=tenant_id), work)


def member(tenant_id: uuid.UUID, role: Role = Role.CONSULTANT) -> MemberPrincipal:
    return MemberPrincipal(f"case-{role}", tenant_id, uuid.uuid4(), role)


def test_a_member_reads_the_whole_case(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    response = api(member(tenant)).get(f"/api/cases/{case.case_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["accession"], body["priority"], body["source"]) == (
        case.accession,
        "stat",
        "manual",
    )
    assert (body["clinical_note"], body["clinical_question"]) == (NOTE, QUESTION)
    assert body["patient"]["name"] == "Eva Testová"
    assert (body["patient"]["birth_date"], body["patient"]["sex"]) == ("1970-01-02", "unknown")
    assert [specimen["letter"] for specimen in body["specimens"]] == ["A", "B"]
    assert [len(specimen["blocks"]) for specimen in body["specimens"]] == [1, 1]
    assert [slide["block_id"] for slide in body["slides"]] == [str(case.block_ids[0]), None]


def test_clinical_text_is_ciphertext_at_rest(database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    stored = query(
        with_database(OWNER_URL, database),
        f"SELECT cases::text FROM cases WHERE id = '{case.case_id}'",
    )[0][0]
    assert "sentinel" not in str(stored)
    assert b"sentinel".hex() not in str(stored)


def test_a_guest_sees_the_shared_case_without_the_patient(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    shared, other = seeded(database, tenant), seeded(database, tenant)
    guest = GuestPrincipal("outside", GuestGrant(host_tenant_id=tenant, case_id=shared.case_id))
    body = api(guest).get(f"/api/cases/{shared.case_id}").json()
    assert (body["patient"], body["clinical_note"], body["clinical_question"]) == (None, None, None)
    assert len(body["specimens"]) == 2
    assert api(guest).get(f"/api/cases/{other.case_id}").status_code == 404


def test_the_guest_scope_hides_patients_and_other_cases_in_the_database(database: str) -> None:
    tenant = make_tenant(database)
    shared, other = seeded(database, tenant), seeded(database, tenant)

    async def visible(connection: AsyncConnection) -> dict[str, Any]:
        counts = {
            table: await connection.scalar(text(f"SELECT count(*) FROM {table}"))
            for table in ("patients", "cases", "specimens", "blocks", "slides")
        }
        counts["other_case"] = await connection.scalar(
            text(f"SELECT count(*) FROM specimens WHERE case_id = '{other.case_id}'")
        )
        return counts

    scope = DatabaseScope(tenant_id=tenant, case_id=shared.case_id)
    assert run(database, scope, visible) == {
        "patients": 0,
        "cases": 1,
        "specimens": 2,
        "blocks": 2,
        "slides": 2,
        "other_case": 0,
    }


def test_records_cannot_point_into_another_workspace(database: str) -> None:
    mine, theirs = make_tenant(database), make_tenant(database)
    their_case = seeded(database, theirs)
    my_case = seeded(database, mine)

    attempts: list[Callable[[AsyncConnection], Awaitable[Any]]] = [
        lambda c: c.execute(
            insert(specimens).values(tenant_id=mine, case_id=their_case.case_id, letter="Z")
        ),
        lambda c: c.execute(
            insert(cases).values(
                tenant_id=mine, patient_id=their_case.patient_id, accession="X-1", source="manual"
            )
        ),
        lambda c: c.execute(
            insert(blocks).values(
                tenant_id=mine,
                case_id=my_case.case_id,
                specimen_id=their_case.specimen_ids[0],
                number=9,
            )
        ),
    ]
    for attempt in attempts:
        with pytest.raises(IntegrityError):
            run(database, DatabaseScope(tenant_id=mine), attempt)


def test_a_block_belongs_to_a_specimen_of_its_own_case(database: str) -> None:
    tenant = make_tenant(database)
    first, second = seeded(database, tenant), seeded(database, tenant)

    async def misfiled(connection: AsyncConnection) -> None:
        await connection.execute(
            insert(blocks).values(
                tenant_id=tenant,
                case_id=second.case_id,
                specimen_id=first.specimen_ids[0],
                number=5,
            )
        )

    with pytest.raises(IntegrityError):
        run(database, DatabaseScope(tenant_id=tenant), misfiled)


def test_other_workspaces_admins_and_deleted_cases_get_nothing(api: ApiAs, database: str) -> None:
    mine, theirs = make_tenant(database), make_tenant(database)
    case = seeded(database, mine)
    path = f"/api/cases/{case.case_id}"
    assert api(member(theirs)).get(path).status_code == 404
    assert api(member(mine, Role.ADMIN)).get(path).status_code == 403
    query(
        with_database(OWNER_URL, database),
        f"UPDATE cases SET deleted_at = now() WHERE id = '{case.case_id}'",
    )
    assert api(member(mine)).get(path).status_code == 404
    assert api(member(mine)).get(f"/api/cases/{uuid.uuid4()}").status_code == 404


@pytest.mark.parametrize(
    ("column", "value"),
    [("priority", "whenever"), ("source", "fax")],
)
def test_codes_outside_the_model_are_refused(database: str, column: str, value: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    with pytest.raises(Exception, match="check constraint"):
        query(
            with_database(OWNER_URL, database),
            f"UPDATE cases SET {column} = '{value}' WHERE id = '{case.case_id}'",
        )
