import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from case_support import SeededCase, seed_case, seed_project
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from workspace_support import join_project, person

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import PrivacyMode, Role, blocks, cases, slides, specimens
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


def reader(database: str, tenant_id: uuid.UUID, *seeds: SeededCase) -> MemberPrincipal:
    who = person(database, tenant_id, f"reader-{uuid.uuid4().hex[:6]}", Role.RESEARCHER)
    for case in seeds:
        join_project(database, case.project_id, who, "viewer")
    return who


def member(tenant_id: uuid.UUID, role: Role = Role.REVIEWER) -> MemberPrincipal:
    return MemberPrincipal(f"case-{role}", tenant_id, uuid.uuid4(), role)


def test_a_member_reads_the_whole_case(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    response = api(reader(database, tenant, case)).get(f"/api/cases/{case.case_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["project_id"], body["label"], body["source"]) == (
        str(case.project_id),
        case.label,
        "manual",
    )
    assert body["patient"]["name"] == "Eva Testová"
    assert (body["patient"]["birth_date"], body["patient"]["sex"]) == ("1970-01-02", "unknown")
    assert [specimen["letter"] for specimen in body["specimens"]] == ["A", "B"]
    assert [len(specimen["blocks"]) for specimen in body["specimens"]] == [1, 1]
    assert [(slide["label"], slide["block_id"]) for slide in body["slides"]] == [
        ("A1", str(case.block_ids[0])),
        ("A2", None),
    ]


def test_cases_list_by_project(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    first, second = seeded(database, tenant), seeded(database, tenant)
    both = reader(database, tenant, first, second)
    listed = api(both).get("/api/cases", params={"project_id": str(first.project_id)})
    assert [row["label"] for row in listed.json()] == [first.label]
    every = {row["id"] for row in api(both).get("/api/cases").json()}
    assert every == {str(first.case_id), str(second.case_id)}


def in_tenant(
    database: str, tenant: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[Any]]
) -> Any:
    return run(database, DatabaseScope(tenant_id=tenant), work)


def test_a_loose_slide_belongs_to_the_project_without_a_case(database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    rows = query(
        with_database(OWNER_URL, database),
        f"SELECT project_id, case_id FROM slides WHERE id = '{case.loose_slide_id}'",
    )
    assert rows == [(case.project_id, None)]


def test_slide_labels_are_unique_per_case_and_among_loose_slides(database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    loose = query(
        with_database(OWNER_URL, database),
        f"SELECT label FROM slides WHERE id = '{case.loose_slide_id}'",
    )[0][0]
    attempts: list[dict[str, Any]] = [
        {"case_id": case.case_id, "label": "A1"},
        {"case_id": None, "label": loose},
    ]
    for values in attempts:
        with pytest.raises(IntegrityError):
            in_tenant(
                database,
                tenant,
                lambda c, v=values: c.execute(
                    insert(slides).values(tenant_id=tenant, project_id=case.project_id, **v)
                ),
            )
    in_tenant(
        database,
        tenant,
        lambda c: c.execute(
            insert(slides).values(
                tenant_id=tenant, project_id=case.project_id, case_id=None, label="A1"
            )
        ),
    )


def test_a_slide_stays_in_its_cases_project_and_a_block_needs_a_case(database: str) -> None:
    tenant = make_tenant(database)
    first, second = seeded(database, tenant), seeded(database, tenant)
    attempts: list[dict[str, Any]] = [
        {"project_id": second.project_id, "case_id": first.case_id, "label": "X1"},
        {
            "project_id": first.project_id,
            "case_id": None,
            "block_id": first.block_ids[0],
            "label": "X2",
        },
    ]
    for values in attempts:
        with pytest.raises(IntegrityError):
            in_tenant(
                database,
                tenant,
                lambda c, v=values: c.execute(insert(slides).values(tenant_id=tenant, **v)),
            )


def test_case_labels_are_unique_within_a_project(database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)

    async def other_project(connection: AsyncConnection) -> uuid.UUID:
        return await seed_project(connection, tenant, PrivacyMode.DE_IDENTIFIED)

    elsewhere = in_tenant(database, tenant, other_project)
    with pytest.raises(IntegrityError):
        in_tenant(
            database,
            tenant,
            lambda c: c.execute(
                insert(cases).values(
                    tenant_id=tenant, project_id=case.project_id, label=case.label, source="manual"
                )
            ),
        )
    in_tenant(
        database,
        tenant,
        lambda c: c.execute(
            insert(cases).values(
                tenant_id=tenant, project_id=elsewhere, label=case.label, source="manual"
            )
        ),
    )


def test_a_cases_patient_comes_from_its_own_project(database: str) -> None:
    tenant = make_tenant(database)
    first, second = seeded(database, tenant), seeded(database, tenant)
    with pytest.raises(IntegrityError):
        in_tenant(
            database,
            tenant,
            lambda c: c.execute(
                insert(cases).values(
                    tenant_id=tenant,
                    project_id=second.project_id,
                    patient_id=first.patient_id,
                    label="Borrowed",
                    source="manual",
                )
            ),
        )


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
                tenant_id=mine,
                project_id=my_case.project_id,
                patient_id=their_case.patient_id,
                label="X-1",
                source="manual",
            )
        ),
        lambda c: c.execute(
            insert(cases).values(
                tenant_id=mine, project_id=their_case.project_id, label="X-2", source="manual"
            )
        ),
        lambda c: c.execute(
            insert(slides).values(tenant_id=mine, project_id=their_case.project_id, label="X-3")
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
    viewer = reader(database, mine, case)
    assert api(viewer).get(path).status_code == 200
    assert api(member(theirs)).get(path).status_code == 404
    admin = MemberPrincipal("case-admin", mine, uuid.uuid4(), Role.RESEARCHER, admin_rights=True)
    assert api(admin).get(path).status_code == 403
    query(
        with_database(OWNER_URL, database),
        f"UPDATE cases SET deleted_at = now() WHERE id = '{case.case_id}'",
    )
    assert api(viewer).get(path).status_code == 404
    assert api(viewer).get(f"/api/cases/{uuid.uuid4()}").status_code == 404


@pytest.mark.parametrize(
    ("table", "column", "value"),
    [("cases", "source", "lis"), ("cases", "source", "fax"), ("projects", "privacy_mode", "open")],
)
def test_codes_outside_the_model_are_refused(
    database: str, table: str, column: str, value: str
) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    row = case.case_id if table == "cases" else case.project_id
    with pytest.raises(Exception, match="check constraint"):
        query(
            with_database(OWNER_URL, database),
            f"UPDATE {table} SET {column} = '{value}' WHERE id = '{row}'",
        )
