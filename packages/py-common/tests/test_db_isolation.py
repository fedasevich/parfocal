import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, cast

import pytest
from sqlalchemy import MetaData, String, Table, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from parfocal_common.db import (
    NAMING_CONVENTION,
    SoftDeletable,
    TenantOwned,
    Timestamped,
    tenant_transaction,
)
from parfocal_common.schema_sql import (
    TENANT_TABLES_WITHOUT_ISOLATION,
    TOUCH_UPDATED_AT_FUNCTION,
    enable_tenant_isolation,
    track_updated_at,
)

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
APP_URL = os.environ.get(
    "PARFOCAL_TEST_APP_URL", "postgresql://parfocal_app@localhost:6432/parfocal"
)
TENANT_A = uuid.UUID("00000000-0000-0000-0000-00000000000a")
TENANT_B = uuid.UUID("00000000-0000-0000-0000-00000000000b")

pytestmark = pytest.mark.db


def async_url(url: str) -> str:
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


@dataclass(frozen=True)
class Fixture:
    schema: str
    owner: AsyncEngine
    app: AsyncEngine
    notes: Table[Any]


def notes_table(schema: str) -> Table[Any]:
    class TestBase(DeclarativeBase):
        metadata = MetaData(schema=schema, naming_convention=NAMING_CONVENTION)

    class Note(TenantOwned, Timestamped, SoftDeletable, TestBase):
        __tablename__ = "notes"
        id: Mapped[int] = mapped_column(primary_key=True)
        body: Mapped[str] = mapped_column(String(200))

    return cast("Table[Any]", Note.__table__)


@pytest.fixture
async def database() -> AsyncIterator[Fixture]:
    schema = f"test_{uuid.uuid4().hex[:12]}"
    owner = create_async_engine(async_url(OWNER_URL))
    app = create_async_engine(async_url(APP_URL))
    notes = notes_table(schema)
    async with owner.begin() as connection:
        await connection.execute(text(f"CREATE SCHEMA {schema}"))
        await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
        await connection.execute(text(TOUCH_UPDATED_AT_FUNCTION))
        await connection.run_sync(notes.metadata.create_all)
        await connection.execute(text(f"GRANT USAGE ON SCHEMA {schema} TO parfocal_app"))
        table_rights = "SELECT, INSERT, UPDATE, DELETE"
        await connection.execute(
            text(f"GRANT {table_rights} ON ALL TABLES IN SCHEMA {schema} TO parfocal_app")
        )
        await connection.execute(
            text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO parfocal_app")
        )
    try:
        yield Fixture(schema=schema, owner=owner, app=app, notes=notes)
    finally:
        async with owner.begin() as connection:
            await connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        await owner.dispose()
        await app.dispose()


async def isolate(database: Fixture) -> None:
    async with database.owner.begin() as connection:
        await connection.execute(text(f"SET LOCAL search_path TO {database.schema}"))
        for statement in enable_tenant_isolation("notes") + track_updated_at("notes"):
            await connection.execute(text(statement))


async def unisolated_tables(database: Fixture) -> list[str]:
    async with database.owner.begin() as connection:
        await connection.execute(text(f"SET LOCAL search_path TO {database.schema}"))
        rows = await connection.execute(text(TENANT_TABLES_WITHOUT_ISOLATION))
        return [row[0] for row in rows]


async def test_constraint_names_follow_the_convention(database: Fixture) -> None:
    async with database.owner.connect() as connection:
        rows = await connection.execute(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE connamespace = CAST(CAST(:namespace AS text) AS regnamespace) "
                "UNION SELECT indexname FROM pg_indexes WHERE schemaname = :schema ORDER BY 1"
            ),
            {"namespace": database.schema, "schema": database.schema},
        )
        assert [row[0] for row in rows] == ["ix_notes_tenant_id", "pk_notes"]


async def test_the_guard_finds_tables_without_isolation(database: Fixture) -> None:
    assert await unisolated_tables(database) == ["notes"]
    await isolate(database)
    assert await unisolated_tables(database) == []


async def test_tenants_only_see_their_rows_through_the_pooler(database: Fixture) -> None:
    await isolate(database)
    notes = database.notes
    async with tenant_transaction(database.app, TENANT_A) as connection:
        await connection.execute(notes.insert().values(tenant_id=TENANT_A, body="a"))
    async with tenant_transaction(database.app, TENANT_B) as connection:
        await connection.execute(notes.insert().values(tenant_id=TENANT_B, body="b"))

    for tenant, expected in ((TENANT_A, ["a"]), (TENANT_B, ["b"])):
        async with tenant_transaction(database.app, tenant) as connection:
            bodies = (await connection.execute(select(notes.c.body))).scalars().all()
            assert bodies == expected

    async with database.app.begin() as connection:
        assert (await connection.execute(select(notes.c.body))).all() == []


async def test_writing_another_tenants_row_is_refused(database: Fixture) -> None:
    await isolate(database)
    with pytest.raises(DBAPIError, match="row-level security"):
        async with tenant_transaction(database.app, TENANT_A) as connection:
            await connection.execute(
                database.notes.insert().values(tenant_id=TENANT_B, body="sneaky")
            )


async def test_updated_at_moves_on_update(database: Fixture) -> None:
    await isolate(database)
    table = database.notes
    async with tenant_transaction(database.app, TENANT_A) as connection:
        await connection.execute(table.insert().values(tenant_id=TENANT_A, body="first"))
    async with tenant_transaction(database.app, TENANT_A) as connection:
        await connection.execute(update(table).values(body="second"))
        created, updated = (
            await connection.execute(select(table.c.created_at, table.c.updated_at))
        ).one()
        assert updated > created
