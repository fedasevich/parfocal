import ast
import asyncio
import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from db_support import ALEMBIC_INI, OWNER_URL, alembic_config, fresh_database, query, with_database
from schema_fingerprint import schema_of
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api import tables
from parfocal_common.db import async_database_url, metadata
from parfocal_common.schema_sql import (
    POLICIES,
    TABLES_WITHOUT_ROW_SECURITY,
    TENANT_TABLES_WITHOUT_ISOLATION,
)

pytestmark = pytest.mark.db


@pytest.fixture
def empty_database() -> Iterator[str]:
    with fresh_database() as name:
        yield with_database(OWNER_URL, name)


def installed(url: str) -> dict[str, bool]:
    extensions = query(url, "SELECT extname FROM pg_extension")
    functions = query(url, "SELECT 1 FROM pg_proc WHERE proname = 'parfocal_touch_updated_at'")
    default_acl = query(url, "SELECT defaclacl::text FROM pg_default_acl")
    table_names = query(url, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    return {
        "postgis": ("postgis",) in extensions,
        "touch_function": len(functions) == 1,
        "app_role_defaults": any("parfocal_app" in str(row[0]) for row in default_acl),
        "tenancy_tables": {("organisations",), ("tenants",)} <= set(table_names),
    }


def test_migrations_upgrade_downgrade_and_upgrade_again(empty_database: str) -> None:
    config = alembic_config(empty_database)
    everything = {
        "postgis": True,
        "touch_function": True,
        "app_role_defaults": True,
        "tenancy_tables": True,
    }

    command.upgrade(config, "head")
    assert installed(empty_database) == everything

    command.downgrade(config, "base")
    assert installed(empty_database) == dict.fromkeys(everything, False)

    command.upgrade(config, "head")
    assert installed(empty_database) == everything


BASELINE = "0115"
MIGRATIONS = ALEMBIC_INI.parent / "migrations"
OLD_CHAIN_SCHEMA = Path(__file__).parent / "fixtures" / "schema_of_the_old_chain.json"


def test_the_baseline_gives_the_schema_of_the_old_chain(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), BASELINE)
    assert schema_of(empty_database) == json.loads(OLD_CHAIN_SCHEMA.read_text())


@pytest.mark.parametrize(
    "changed",
    [
        "ALTER TABLE cases DROP CONSTRAINT ck_cases_source",
        "ALTER TABLE cases ALTER COLUMN label DROP NOT NULL",
        "REVOKE DELETE ON cases FROM parfocal_app",
        "UPDATE registered_models SET status = 'retired'",
    ],
)
def test_a_changed_schema_differs_from_the_old_chain(empty_database: str, changed: str) -> None:
    command.upgrade(alembic_config(empty_database), BASELINE)
    query(empty_database, changed)
    assert schema_of(empty_database) != json.loads(OLD_CHAIN_SCHEMA.read_text())


def imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def test_the_baseline_imports_no_application_code() -> None:
    baseline = next((MIGRATIONS / "versions").glob(f"{BASELINE}_*.py"))
    assert not {module for module in imported_modules(baseline) if module.startswith("parfocal")}
    assert "parfocal_api" not in (MIGRATIONS / "baseline.sql").read_text()


def test_every_tenant_table_is_isolated_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TENANT_TABLES_WITHOUT_ISOLATION) == []


def test_every_table_has_forced_row_security_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TABLES_WITHOUT_ROW_SECURITY) == []


REVIEWED_POLICIES = Path(__file__).parent / "fixtures" / "policies_at_head.json"
STANDARD_POLICY: tuple[object, ...] = (
    "tenant_isolation",
    "*",
    True,
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
    [],
)


def policies_of(url: str) -> dict[str, list[object]]:
    rows = query(url, POLICIES)
    standard = sorted(str(row[0]) for row in rows if row[1:] == STANDARD_POLICY)
    other = [list(row) for row in rows if row[1:] != STANDARD_POLICY]
    return {"standard": [*standard], "other": [*other]}


def reviewed_policies() -> dict[str, list[object]]:
    return json.loads(REVIEWED_POLICIES.read_text())


def test_the_policies_at_head_are_the_reviewed_ones(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    found = policies_of(empty_database)
    if os.environ.get("PARFOCAL_WRITE_POLICIES"):
        REVIEWED_POLICIES.write_text(json.dumps(found, indent=2) + "\n")
    assert found == reviewed_policies()


@pytest.mark.parametrize(
    "loosened",
    [
        "ALTER POLICY tenant_isolation ON cases USING (true)",
        "CREATE POLICY readers ON cases FOR SELECT USING (true)",
        "ALTER POLICY tenant_isolation ON cases TO parfocal",
        "ALTER POLICY tenant_isolation ON cases WITH CHECK (true)",
    ],
)
def test_a_loosened_or_added_policy_differs_from_the_reviewed_ones(
    empty_database: str, loosened: str
) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    query(empty_database, loosened)
    assert policies_of(empty_database) != reviewed_policies()


async def test_models_match_the_migrations(empty_database: str) -> None:
    assert tables.tenants.metadata is metadata
    await asyncio.to_thread(command.upgrade, alembic_config(empty_database), "head")
    engine = create_async_engine(async_database_url(empty_database))

    def differences(connection: Connection) -> list[object]:
        context = MigrationContext.configure(connection)
        return [
            difference
            for difference in compare_metadata(context, metadata)
            if not (difference[0] == "remove_table" and difference[1].name == "spatial_ref_sys")
        ]

    try:
        async with engine.connect() as connection:
            assert await connection.run_sync(differences) == []
    finally:
        await engine.dispose()
