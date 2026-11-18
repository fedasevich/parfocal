import asyncio
import os
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_common.db import DatabaseScope, begin_in_scope, create_engine, scoped_transaction

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
USER = uuid.UUID("00000000-0000-4000-8000-000000000002")


class CountingProxy:
    def __init__(self, port: int) -> None:
        self.port = port
        self.sends = 0
        self.server: asyncio.Server | None = None

    async def pipe(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, counted: bool
    ) -> None:
        try:
            while data := await reader.read(65536):
                if counted:
                    self.sends += 1
                writer.write(data)
                await writer.drain()
        finally:
            writer.close()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        upstream_reader, upstream_writer = await asyncio.open_connection("127.0.0.1", self.port)
        await asyncio.gather(
            self.pipe(reader, upstream_writer, True),
            self.pipe(upstream_reader, writer, False),
            return_exceptions=True,
        )

    async def start(self) -> int:
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        return int(self.server.sockets[0].getsockname()[1])

    async def close(self) -> None:
        if self.server is not None:
            self.server.close()


@asynccontextmanager
async def counted_engine() -> AsyncGenerator[tuple[AsyncEngine, CountingProxy]]:
    host_and_port = OWNER_URL.split("@", 1)[1].split("/", 1)[0]
    proxy = CountingProxy(int(host_and_port.split(":")[1]) if ":" in host_and_port else 5432)
    port = await proxy.start()
    engine = create_engine(OWNER_URL.replace(host_and_port, f"127.0.0.1:{port}"))
    try:
        yield engine, proxy
    finally:
        await engine.dispose()
        await proxy.close()


@asynccontextmanager
async def scratch_table(engine: AsyncEngine) -> AsyncGenerator[str]:
    name = f"round_trip_{uuid.uuid4().hex[:10]}"
    async with engine.begin() as connection:
        await connection.execute(
            text(
                f"CREATE TABLE {name} (id int, label text, "
                "UNIQUE (label) DEFERRABLE INITIALLY DEFERRED)"
            )
        )
    try:
        yield name
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f"DROP TABLE {name}"))


async def labels(engine: AsyncEngine, table: str) -> list[str]:
    async with scoped_transaction(engine, DatabaseScope()) as connection:
        return list(
            (await connection.execute(text(f"SELECT label FROM {table} ORDER BY id"))).scalars()
        )


async def write_then_fail(engine: AsyncEngine, table: str) -> None:
    async with scoped_transaction(engine, DatabaseScope()) as connection:
        await connection.execute(text(f"INSERT INTO {table} VALUES (1, 'lost')"))
        raise RuntimeError


async def duplicates_in_a_savepoint(connection: AsyncConnection, table: str) -> None:
    async with connection.begin_nested():
        await connection.execute(text(f"INSERT INTO {table} VALUES (3, 'inner'), (4, 'inner')"))
        await connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def test_the_scope_is_written_as_literals_and_refuses_anything_but_ids() -> None:
    statement = begin_in_scope(DatabaseScope(tenant_id=TENANT, user_id=USER, auth=True))
    assert statement.startswith("BEGIN; SELECT set_config('app.tenant_id', ")
    assert f"'{TENANT}'" in statement
    assert f"'{USER}'" in statement
    assert "set_config('app.auth', 'on', true)" in statement
    sneaky = DatabaseScope(tenant_id="x', true); DROP TABLE users; --")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="UUID"):
        begin_in_scope(sneaky)


@pytest.mark.db
async def test_a_scoped_read_costs_one_round_trip_more_than_its_statements() -> None:
    async with counted_engine() as (engine, proxy):
        query = text("SELECT current_setting('app.tenant_id', true)")
        scope = DatabaseScope(tenant_id=TENANT)
        for _ in range(2):
            async with scoped_transaction(engine, scope) as connection:
                await connection.execute(query)
        before = proxy.sends
        async with scoped_transaction(engine, scope) as connection:
            assert (await connection.execute(query)).scalar_one() == str(TENANT)
            await connection.execute(query)
        assert proxy.sends - before == 4


@pytest.mark.db
async def test_the_scope_ends_with_the_transaction_and_writes_commit() -> None:
    engine = create_engine(OWNER_URL)
    try:
        async with scratch_table(engine) as table:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=TENANT)) as connection:
                await connection.execute(text(f"INSERT INTO {table} VALUES (1, 'kept')"))
            async with scoped_transaction(engine, DatabaseScope()) as connection:
                setting = text("SELECT current_setting('app.tenant_id', true)")
                assert (await connection.execute(setting)).scalar_one() == ""
            assert await labels(engine, table) == ["kept"]
    finally:
        await engine.dispose()


@pytest.mark.db
async def test_an_error_rolls_back_and_a_savepoint_keeps_the_outer_writes() -> None:
    engine = create_engine(OWNER_URL)
    try:
        async with scratch_table(engine) as table:
            with pytest.raises(RuntimeError):
                await write_then_fail(engine, table)
            async with scoped_transaction(engine, DatabaseScope()) as connection:
                await connection.execute(text(f"INSERT INTO {table} VALUES (2, 'outer')"))
                with pytest.raises(IntegrityError):
                    await duplicates_in_a_savepoint(connection, table)
            assert await labels(engine, table) == ["outer"]
    finally:
        await engine.dispose()


@pytest.mark.db
async def test_a_constraint_that_fails_at_commit_raises_an_integrity_error() -> None:
    engine = create_engine(OWNER_URL)
    try:
        async with scratch_table(engine) as table:
            with pytest.raises(IntegrityError):
                async with scoped_transaction(engine, DatabaseScope()) as connection:
                    await connection.execute(
                        text(f"INSERT INTO {table} VALUES (1, 'same'), (2, 'same')")
                    )
            assert await labels(engine, table) == []
    finally:
        await engine.dispose()
