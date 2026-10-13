import asyncio
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from db_support import OWNER_URL, alembic_config, fresh_database, query, with_database
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api import tables
from parfocal_common.db import async_database_url, metadata
from parfocal_common.schema_sql import TABLES_WITHOUT_ROW_SECURITY, TENANT_TABLES_WITHOUT_ISOLATION

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


def test_every_tenant_table_is_isolated_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TENANT_TABLES_WITHOUT_ISOLATION) == []


def test_every_table_has_forced_row_security_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TABLES_WITHOUT_ROW_SECURITY) == []


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
