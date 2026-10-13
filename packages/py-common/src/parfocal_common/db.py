import uuid
from collections.abc import AsyncGenerator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import DateTime, MetaData, Uuid, func, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

TENANT_SETTING = "app.tenant_id"
SCOPE_CASE_SETTING = "app.scope_case_id"
SCOPE_VIEW_SETTING = "app.scope_view_id"
PLATFORM_SETTING = "app.platform"
AUTH_SETTING = "app.auth"
CURRENT_TENANT = f"NULLIF(current_setting('{TENANT_SETTING}', true), '')::uuid"
PLATFORM_OPERATOR = f"COALESCE(current_setting('{PLATFORM_SETTING}', true), '') = 'on'"
AUTH_SERVICE = f"COALESCE(current_setting('{AUTH_SETTING}', true), '') = 'on'"

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


@dataclass(frozen=True)
class DatabaseScope:
    tenant_id: uuid.UUID | None = None
    case_id: uuid.UUID | None = None
    view_id: uuid.UUID | None = None
    platform: bool = False
    auth: bool = False

    def parameters(self) -> dict[str, str]:
        return {
            "tenant": str(self.tenant_id or ""),
            "case": str(self.case_id or ""),
            "view": str(self.view_id or ""),
            "platform": "on" if self.platform else "",
            "auth": "on" if self.auth else "",
        }


SET_SCOPE = text(
    f"SELECT set_config('{TENANT_SETTING}', :tenant, true), "
    f"set_config('{SCOPE_CASE_SETTING}', :case, true), "
    f"set_config('{SCOPE_VIEW_SETTING}', :view, true), "
    f"set_config('{PLATFORM_SETTING}', :platform, true), "
    f"set_config('{AUTH_SETTING}', :auth, true)"
)


def async_database_url(url: str) -> str:
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


def create_engine(url: str) -> AsyncEngine:
    return create_async_engine(async_database_url(url))


@asynccontextmanager
async def scoped_transaction(
    engine: AsyncEngine, scope: DatabaseScope
) -> AsyncGenerator[AsyncConnection]:
    async with engine.begin() as connection:
        await connection.execute(SET_SCOPE, scope.parameters())
        yield connection


def tenant_transaction(
    engine: AsyncEngine, tenant_id: uuid.UUID
) -> AbstractAsyncContextManager[AsyncConnection]:
    return scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id))
