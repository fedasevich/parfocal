import asyncio
import os
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from parfocal_deploy.deploy import MIGRATE
from parfocal_deploy.reset import AUDIT_TRUNCATE_GUARD, reset_statement
from parfocal_deploy.restore_check import (
    create_database,
    drop_database,
    scratch_name,
    with_database,
)

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[3]

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
A_TENANT = (
    "WITH organisation AS (INSERT INTO organisations (slug, name) "
    "VALUES ('reset-test', 'Reset test') RETURNING id) "
    "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
    "SELECT id, 'reset-test', 'Reset test', 'diagnostic', 'eu', 'pilot' FROM organisation"
)
GUARD_STATE = f"SELECT tgenabled::text FROM pg_trigger WHERE tgname = '{AUDIT_TRUNCATE_GUARD}'"


@pytest.fixture
async def migrated() -> AsyncIterator[str]:
    name = scratch_name()
    await create_database(OWNER_URL, name)
    url = with_database(OWNER_URL, name)
    try:
        await asyncio.to_thread(
            subprocess.run,
            MIGRATE,
            check=True,
            cwd=ROOT,
            env={**os.environ, "MIGRATION_DATABASE_URL": url},
        )
        yield url
    finally:
        await drop_database(OWNER_URL, name)


async def test_the_reset_empties_a_migrated_database_and_keeps_the_audit_guard(
    migrated: str,
) -> None:
    connection = await asyncpg.connect(migrated)
    try:
        await connection.execute(A_TENANT)
        await connection.execute(reset_statement())
        assert await connection.fetchval("SELECT count(*) FROM tenants") == 0
        assert await connection.fetchval(GUARD_STATE) == "O"
        with pytest.raises(asyncpg.PostgresError, match="append-only"):
            await connection.execute("TRUNCATE audit_events")
    finally:
        await connection.close()
