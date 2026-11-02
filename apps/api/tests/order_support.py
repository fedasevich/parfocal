import asyncio
import uuid

from db_support import APP_URL, with_database
from storage_support import TEST_STORAGE

from parfocal_api.review_order_job import review_order_workflow
from parfocal_common.db import DatabaseScope, async_database_url, create_engine, scoped_transaction
from parfocal_common.jobs import JobControl, move, work

ORDERS = review_order_workflow(lambda: TEST_STORAGE)


def run_orders(database: str, tenant_id: uuid.UUID) -> None:
    async def go() -> None:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            await work(engine, [ORDERS], "test", 0.2, 0.1, tenant_id)
        finally:
            await engine.dispose()

    asyncio.run(go())


def retry_order(database: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> None:
    async def go() -> None:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
                moved = await move(connection, job_id, JobControl.RETRY)
                assert moved is not None
                assert moved.after is not None
        finally:
            await engine.dispose()

    asyncio.run(go())
