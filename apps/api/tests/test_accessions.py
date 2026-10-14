import asyncio
import uuid
from collections.abc import Awaitable, Callable

import pytest
from case_support import seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.accessions import (
    AccessionFormat,
    AccessionFormatError,
    AccessionRangeFullError,
    AccessionTakenError,
    InvalidTemplateError,
    allocate_accession,
    check_imported_accession,
    validate_template,
)
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

KIT = AccessionFormat("{prefix}{yy}-{seq:5}", ("S", "C"))


def test_the_kit_format_renders_and_matches() -> None:
    assert KIT.render("S", 2026, 4830) == "S26-04830"
    assert KIT.matches("S26-04830")
    assert KIT.matches("C26-00001")
    for wrong in ("X26-04830", "S26-4830", "S2026-04830", "s26-04830", "S26-04830 ", "S26_04830"):
        assert not KIT.matches(wrong), wrong
    long_year = AccessionFormat("{yyyy}/{prefix}{seq:6}", ("BX",))
    assert long_year.render("BX", 2026, 7) == "2026/BX000007"
    assert long_year.matches("2026/BX000007")


@pytest.mark.parametrize(
    "template",
    [
        "{prefix}{yy}",
        "{yy}-{seq:5}",
        "{prefix}{seq:5}",
        "{prefix}{yy}{yyyy}{seq:5}",
        "{prefix}{yy}-{seq:2}",
        "{prefix}{yy}-{seq:9}",
        "{prefix}{yy} {seq:5}",
        "{prefix}{yy}-{seq:5}-{seq:5}",
        "lab-{prefix}{yy}-{seq:5}",
        "{prefix}{yy}-{seq:5}" + "-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ],
)
def test_bad_templates_are_refused(template: str) -> None:
    with pytest.raises(InvalidTemplateError):
        validate_template(template)


def make_tenant(database: str) -> uuid.UUID:
    slug = f"acc-{uuid.uuid4().hex[:10]}"
    rows = query(
        with_database(OWNER_URL, database),
        "WITH organisation AS (INSERT INTO organisations (slug, name) "
        f"VALUES ('{slug}', '{slug}') RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
        "RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def in_tenant[T](
    database: str, tenant_id: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[T]]
) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as c:
                return await work(c)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def allocate(database: str, tenant_id: uuid.UUID, prefix: str = "S", year: int = 2026) -> str:
    async def work(connection: AsyncConnection) -> str:
        return await allocate_accession(connection, tenant_id, prefix, year)

    return in_tenant(database, tenant_id, work)


@pytest.mark.db
def test_numbers_count_up_per_prefix_and_year(database: str) -> None:
    tenant = make_tenant(database)
    assert [allocate(database, tenant) for _ in range(3)] == [
        "S26-00001",
        "S26-00002",
        "S26-00003",
    ]
    assert allocate(database, tenant, year=2027) == "S27-00001"
    other = make_tenant(database)
    assert allocate(database, other) == "S26-00001"
    with pytest.raises(AccessionFormatError):
        allocate(database, tenant, prefix="C")


@pytest.mark.db
def test_concurrent_cases_never_share_a_number(database: str) -> None:
    tenant = make_tenant(database)

    async def many() -> list[str]:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))

        async def one() -> str:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
                return await allocate_accession(connection, tenant, "S", 2026)

        try:
            return list(await asyncio.gather(*(one() for _ in range(25))))
        finally:
            await engine.dispose()

    numbers = asyncio.run(many())
    assert sorted(numbers) == [f"S26-{n:05d}" for n in range(1, 26)]


@pytest.mark.db
def test_allocation_skips_numbers_imported_from_the_lis(database: str) -> None:
    tenant = make_tenant(database)

    async def import_two(connection: AsyncConnection) -> None:
        for number in ("S26-00001", "S26-00002"):
            case = await seed_case(connection, tenant)
            await connection.exec_driver_sql(
                f"UPDATE cases SET accession = '{number}' WHERE id = '{case.case_id}'"
            )

    in_tenant(database, tenant, import_two)
    assert allocate(database, tenant) == "S26-00003"


@pytest.mark.db
def test_imported_numbers_must_match_and_be_free(database: str) -> None:
    tenant = make_tenant(database)
    first = allocate(database, tenant)

    async def seeded_with(connection: AsyncConnection) -> None:
        case = await seed_case(connection, tenant)
        await connection.exec_driver_sql(
            f"UPDATE cases SET accession = '{first}' WHERE id = '{case.case_id}'"
        )

    in_tenant(database, tenant, seeded_with)

    def check(value: str) -> Callable[[AsyncConnection], Awaitable[str]]:
        async def work(connection: AsyncConnection) -> str:
            return await check_imported_accession(connection, tenant, value)

        return work

    assert in_tenant(database, tenant, check("S26-00999")) == "S26-00999"
    with pytest.raises(AccessionTakenError):
        in_tenant(database, tenant, check(first))
    with pytest.raises(AccessionFormatError):
        in_tenant(database, tenant, check("26-00999"))


@pytest.mark.db
def test_a_full_range_is_refused(database: str) -> None:
    tenant = make_tenant(database)
    query(
        with_database(OWNER_URL, database),
        "INSERT INTO accession_counters (tenant_id, prefix, year, last_value) "
        f"VALUES ('{tenant}', 'S', 2026, 99999)",
    )
    with pytest.raises(AccessionRangeFullError):
        allocate(database, tenant)


@pytest.mark.db
def test_a_lead_changes_the_format_and_sees_the_next_numbers(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    subject = f"acc-lead-{uuid.uuid4().hex[:8]}"
    user_id = query(
        with_database(OWNER_URL, database),
        "INSERT INTO users (subject, display_name, initials, avatar_colour) "
        f"VALUES ('{subject}', 'Lead', 'LE', 1) RETURNING id",
    )[0][0]
    lead = MemberPrincipal(subject, tenant, uuid.UUID(str(user_id)), Role.LEAD)
    view = api(lead).get("/api/tenant/accession-format").json()
    assert (view["template"], view["prefixes"]) == ("{prefix}{yy}-{seq:5}", ["S"])
    assert view["next"]["S"].endswith("-00001")
    change = {"template": "{prefix}{yyyy}/{seq:6}", "prefixes": ["BX", "CY"]}
    changed = api(lead).put("/api/tenant/accession-format", json=change)
    assert changed.status_code == 200, changed.text
    assert sorted(changed.json()["next"]) == ["BX", "CY"]
    assert changed.json()["next"]["CY"].endswith("/000001")
    bad_changes: list[dict[str, object]] = [
        {"template": "{prefix}{yy}", "prefixes": ["S"]},
        {"template": "{prefix}{yy}-{seq:5}", "prefixes": ["s"]},
        {"template": "{prefix}{yy}-{seq:5}", "prefixes": []},
    ]
    for bad in bad_changes:
        assert api(lead).put("/api/tenant/accession-format", json=bad).status_code == 422
    actions = query(
        with_database(OWNER_URL, database),
        f"SELECT action FROM audit_events WHERE tenant_id = '{tenant}'",
    )
    assert actions == [("tenant.accession-format-changed",)]
