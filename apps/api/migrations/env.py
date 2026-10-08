import asyncio
import os

from alembic import context
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_common.db import metadata

LOCAL_OWNER_URL = "postgresql://parfocal@localhost:5432/parfocal"


def migration_url() -> str:
    configured = context.config.attributes.get("url") or os.environ.get(
        "MIGRATION_DATABASE_URL", LOCAL_OWNER_URL
    )
    return str(configured).replace("postgresql://", "postgresql+asyncpg://", 1)


def run(connection: Connection) -> None:
    context.configure(
        connection=connection, target_metadata=metadata, transaction_per_migration=True
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    engine = create_async_engine(migration_url())
    async with engine.connect() as connection:
        await connection.run_sync(run)
    await engine.dispose()


asyncio.run(run_online())
