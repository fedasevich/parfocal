import asyncio
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_common.schema_sql import TENANT_TABLES_WITHOUT_ISOLATION

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"

pytestmark = pytest.mark.db


def with_database(url: str, name: str) -> str:
    return f"{url.rsplit('/', 1)[0]}/{name}"


async def run_sql(url: str, statement: str) -> list[tuple[object, ...]]:
    engine = create_async_engine(
        url.replace("postgresql://", "postgresql+asyncpg://", 1), isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(statement))
            return [tuple(row) for row in result.all()] if result.returns_rows else []
    finally:
        await engine.dispose()


def query(url: str, statement: str) -> list[tuple[object, ...]]:
    return asyncio.run(run_sql(url, statement))


@pytest.fixture
def empty_database() -> Iterator[str]:
    name = f"parfocal_migrate_{uuid.uuid4().hex[:12]}"
    query(OWNER_URL, f"CREATE DATABASE {name}")
    try:
        yield with_database(OWNER_URL, name)
    finally:
        query(OWNER_URL, f"DROP DATABASE {name} WITH (FORCE)")


def alembic_config(url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["url"] = url
    return config


def installed(url: str) -> dict[str, bool]:
    extensions = query(url, "SELECT extname FROM pg_extension")
    functions = query(url, "SELECT 1 FROM pg_proc WHERE proname = 'parfocal_touch_updated_at'")
    default_acl = query(url, "SELECT defaclacl::text FROM pg_default_acl")
    return {
        "postgis": ("postgis",) in extensions,
        "touch_function": len(functions) == 1,
        "app_role_defaults": any("parfocal_app" in str(row[0]) for row in default_acl),
    }


def test_migrations_upgrade_downgrade_and_upgrade_again(empty_database: str) -> None:
    config = alembic_config(empty_database)
    everything = {"postgis": True, "touch_function": True, "app_role_defaults": True}

    command.upgrade(config, "head")
    assert installed(empty_database) == everything

    command.downgrade(config, "base")
    assert installed(empty_database) == dict.fromkeys(everything, False)

    command.upgrade(config, "head")
    assert installed(empty_database) == everything


def test_every_tenant_table_is_isolated_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TENANT_TABLES_WITHOUT_ISOLATION) == []
