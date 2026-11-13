import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_common.db import async_database_url, create_engine

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)

pytestmark = pytest.mark.db


async def test_a_connection_closed_by_the_server_is_replaced_before_use() -> None:
    engine = create_engine(OWNER_URL)
    killer = create_async_engine(async_database_url(OWNER_URL))
    try:
        async with engine.connect() as connection:
            first = (await connection.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        async with killer.connect() as connection:
            await connection.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": first})
        async with engine.connect() as connection:
            second = (await connection.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        assert second != first
    finally:
        await engine.dispose()
        await killer.dispose()
