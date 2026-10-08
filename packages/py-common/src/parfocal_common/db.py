import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import datetime

from sqlalchemy import DateTime, MetaData, Uuid, func, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

TENANT_SETTING = "app.tenant_id"
CURRENT_TENANT = f"NULLIF(current_setting('{TENANT_SETTING}', true), '')::uuid"

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    metadata = metadata


class TenantOwned:
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SoftDeletable:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


@asynccontextmanager
async def tenant_transaction(
    engine: AsyncEngine, tenant_id: uuid.UUID
) -> AsyncGenerator[AsyncConnection]:
    async with engine.begin() as connection:
        await connection.execute(
            text("SELECT set_config(:name, :tenant, true)"),
            {"name": TENANT_SETTING, "tenant": str(tenant_id)},
        )
        yield connection
