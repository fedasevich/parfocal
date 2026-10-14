from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.auth import authenticate
from parfocal_api.principals import (
    GuestPrincipal,
    MemberPrincipal,
    MissingGuestGrantError,
    PlatformOperator,
    Principal,
    ServicePrincipal,
    SignedInUser,
    database_scope,
)
from parfocal_api.problems import ForbiddenError, TenantSuspendedError
from parfocal_api.tables import TenantStatus, tenants
from parfocal_common.db import scoped_transaction


def engine_of(request: Request) -> AsyncEngine:
    return cast("AsyncEngine", request.app.state.engine)


async def tenant_connection(
    request: Request, principal: Annotated[Principal, Depends(authenticate)]
) -> AsyncIterator[AsyncConnection]:
    if not isinstance(principal, MemberPrincipal | GuestPrincipal | ServicePrincipal):
        raise ForbiddenError
    try:
        scope = database_scope(principal)
    except MissingGuestGrantError as error:
        raise ForbiddenError from error
    async with scoped_transaction(engine_of(request), scope) as connection:
        status = await connection.scalar(
            select(tenants.c.status).where(tenants.c.id == scope.tenant_id)
        )
        if status is None:
            raise ForbiddenError
        if status == TenantStatus.SUSPENDED:
            raise TenantSuspendedError
        yield connection


async def platform_connection(
    request: Request, principal: Annotated[Principal, Depends(authenticate)]
) -> AsyncIterator[AsyncConnection]:
    if not isinstance(principal, PlatformOperator):
        raise ForbiddenError
    async with scoped_transaction(engine_of(request), database_scope(principal)) as connection:
        yield connection


async def user_connection(
    request: Request, principal: Annotated[Principal, Depends(authenticate)]
) -> AsyncIterator[AsyncConnection]:
    if not isinstance(principal, SignedInUser | MemberPrincipal):
        raise ForbiddenError
    async with scoped_transaction(engine_of(request), database_scope(principal)) as connection:
        yield connection


TenantConnection = Annotated[AsyncConnection, Depends(tenant_connection, scope="function")]
PlatformConnection = Annotated[AsyncConnection, Depends(platform_connection, scope="function")]
UserConnection = Annotated[AsyncConnection, Depends(user_connection, scope="function")]
CurrentPrincipal = Annotated[Principal, Depends(authenticate)]
