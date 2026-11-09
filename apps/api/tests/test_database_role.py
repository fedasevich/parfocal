import asyncio

import pytest
from db_support import APP_URL, OWNER_URL, api_settings, with_database
from fastapi.testclient import TestClient
from pydantic import PostgresDsn

from parfocal_api import operators, stale_uploads
from parfocal_api.app import create_app
from parfocal_common.db import UnsafeDatabaseRoleError, create_engine, require_row_security
from parfocal_common.jobs import work

pytestmark = pytest.mark.db


async def checked(url: str) -> None:
    engine = create_engine(url)
    try:
        await require_row_security(engine)
    finally:
        await engine.dispose()


async def worked(url: str) -> int:
    engine = create_engine(url)
    try:
        return await work(engine, [], "role-check", idle_exit_seconds=0)
    finally:
        await engine.dispose()


def test_the_application_role_passes_the_check(database: str) -> None:
    asyncio.run(checked(with_database(APP_URL, database)))


def test_a_role_that_bypasses_row_security_is_refused_by_name(database: str) -> None:
    with pytest.raises(UnsafeDatabaseRoleError, match="parfocal"):
        asyncio.run(checked(with_database(OWNER_URL, database)))


def test_the_api_refuses_to_start_as_a_role_that_bypasses_row_security(database: str) -> None:
    owner = PostgresDsn(with_database(OWNER_URL, database))
    settings = api_settings(database).model_copy(update={"database_url": owner})
    with pytest.raises(UnsafeDatabaseRoleError), TestClient(create_app(settings)):
        pass


def test_the_worker_loop_refuses_a_role_that_bypasses_row_security(database: str) -> None:
    with pytest.raises(UnsafeDatabaseRoleError):
        asyncio.run(worked(with_database(OWNER_URL, database)))


def test_the_stale_upload_job_refuses_a_role_that_bypasses_row_security(database: str) -> None:
    owner = PostgresDsn(with_database(OWNER_URL, database))
    settings = api_settings(database).model_copy(update={"database_url": owner})
    with pytest.raises(UnsafeDatabaseRoleError):
        asyncio.run(stale_uploads.run_once(settings))


def test_the_operator_command_refuses_a_role_that_bypasses_row_security(database: str) -> None:
    with pytest.raises(UnsafeDatabaseRoleError):
        asyncio.run(operators.run(with_database(OWNER_URL, database), "list", None))
