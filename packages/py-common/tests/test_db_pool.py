import os
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from parfocal_common import db
from parfocal_common.db import async_database_url, create_engine

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)

pytestmark = pytest.mark.db


async def backend_pid(engine: AsyncEngine) -> int:
    async with engine.connect() as connection:
        return int((await connection.execute(text("SELECT pg_backend_pid()"))).scalar_one())


async def test_an_idle_connection_closed_by_the_server_is_replaced_before_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(db, "PING_AFTER_IDLE_SECONDS", 0.0)
    engine = create_engine(OWNER_URL)
    killer = create_async_engine(async_database_url(OWNER_URL))
    try:
        first = await backend_pid(engine)
        async with killer.connect() as connection:
            await connection.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": first})
        assert await backend_pid(engine) != first
    finally:
        await engine.dispose()
        await killer.dispose()


async def test_a_connection_used_moments_ago_is_not_pinged_again() -> None:
    engine = create_engine(OWNER_URL)
    pings: list[Any] = []
    real_ping = engine.dialect.do_ping

    def counted(connection: Any) -> bool:
        pings.append(connection)
        return real_ping(connection)

    engine.dialect.do_ping = counted  # type: ignore[method-assign]
    try:
        first = await backend_pid(engine)
        assert await backend_pid(engine) == first
        assert await backend_pid(engine) == first
        assert pings == []
    finally:
        await engine.dispose()
