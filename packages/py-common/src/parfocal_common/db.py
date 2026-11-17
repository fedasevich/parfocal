import uuid
from collections.abc import AsyncGenerator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKeyConstraint,
    MetaData,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.db_timing import time_queries, timed_transaction

TENANT_SETTING = "app.tenant_id"
PLATFORM_SETTING = "app.platform"
AUTH_SETTING = "app.auth"
USER_SETTING = "app.user_id"
CURRENT_TENANT = f"NULLIF(current_setting('{TENANT_SETTING}', true), '')::uuid"
PLATFORM_OPERATOR = f"COALESCE(current_setting('{PLATFORM_SETTING}', true), '') = 'on'"
AUTH_SERVICE = f"COALESCE(current_setting('{AUTH_SETTING}', true), '') = 'on'"
CURRENT_USER = f"NULLIF(current_setting('{USER_SETTING}', true), '')::uuid"

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


def tenant_foreign_key(
    column: str, parent: str, ondelete: str | None = None, name: str | None = None
) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        [column, "tenant_id"],
        [f"{parent}.id", f"{parent}.tenant_id"],
        ondelete=ondelete,
        name=name,
    )


def tenant_unique(*columns: str) -> UniqueConstraint:
    return UniqueConstraint(*(columns or ("id",)), "tenant_id")


class Base(DeclarativeBase):
    metadata = metadata


class TenantOwned:
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True, info=OPERATIONAL)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), info=OPERATIONAL
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), info=OPERATIONAL
    )


class SoftDeletable:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, info=OPERATIONAL
    )


@dataclass(frozen=True)
class DatabaseScope:
    tenant_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    platform: bool = False
    auth: bool = False

    def parameters(self) -> dict[str, str]:
        return {
            "tenant": str(self.tenant_id or ""),
            "user": str(self.user_id or ""),
            "platform": "on" if self.platform else "",
            "auth": "on" if self.auth else "",
        }


SET_SCOPE = text(
    f"SELECT set_config('{TENANT_SETTING}', :tenant, true), "
    f"set_config('{USER_SETTING}', :user, true), "
    f"set_config('{PLATFORM_SETTING}', :platform, true), "
    f"set_config('{AUTH_SETTING}', :auth, true)"
)


ROLE_BYPASSES_ROW_SECURITY = text(
    "SELECT current_user, EXISTS ("
    "SELECT 1 FROM pg_roles "
    "WHERE (rolsuper OR rolbypassrls) AND pg_has_role(current_user, oid, 'member'))"
)


class UnsafeDatabaseRoleError(RuntimeError):
    def __init__(self, role: str) -> None:
        super().__init__(
            f"The database role {role} can bypass row-level security, "
            "so it would read and change every workspace's rows"
        )


def async_database_url(url: str) -> str:
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


POOL_SIZE = 10
POOL_OVERFLOW = 10


def create_engine(url: str) -> AsyncEngine:
    engine = create_async_engine(
        async_database_url(url),
        pool_pre_ping=True,
        pool_size=POOL_SIZE,
        max_overflow=POOL_OVERFLOW,
    )
    time_queries(engine.sync_engine)
    return engine


async def require_row_security(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        role, bypasses = (await connection.execute(ROLE_BYPASSES_ROW_SECURITY)).one()
    if bypasses:
        raise UnsafeDatabaseRoleError(role)


@asynccontextmanager
async def scoped_transaction(
    engine: AsyncEngine, scope: DatabaseScope
) -> AsyncGenerator[AsyncConnection]:
    with timed_transaction():
        async with engine.begin() as connection:
            await connection.execute(SET_SCOPE, scope.parameters())
            yield connection


def tenant_transaction(
    engine: AsyncEngine, tenant_id: uuid.UUID
) -> AbstractAsyncContextManager[AsyncConnection]:
    return scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id))
