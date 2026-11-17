import uuid
from collections.abc import Mapping
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import workspace_settings
from parfocal_common.db import SET_SCOPE, DatabaseScope

TWO_FACTOR_KEY = "two_factor_required"
MULTI_FACTOR_AMR = "mfa"


class SecondFactorRequiredError(ForbiddenError):
    code = "second-factor-required"
    title = (
        "This workspace asks for a second factor. Set up an authenticator app or a security key, "
        "then sign in again"
    )


def factors_of(claims: Mapping[str, Any]) -> list[str]:
    amr = claims.get("amr")
    if not isinstance(amr, list):
        return []
    return [value for value in cast("list[object]", amr) if isinstance(value, str)]


def has_second_factor(tokens: Mapping[str, Any]) -> bool:
    return MULTI_FACTOR_AMR in factors_of(tokens)


async def requires_two_factors(connection: AsyncConnection, tenant_id: uuid.UUID) -> bool:
    await connection.execute(SET_SCOPE, DatabaseScope(tenant_id=tenant_id, auth=True).parameters())
    stored = await connection.scalar(
        select(workspace_settings.c["values"]).where(workspace_settings.c.tenant_id == tenant_id)
    )
    await connection.execute(SET_SCOPE, DatabaseScope(auth=True).parameters())
    return two_factors_in(stored)


def two_factors_in(stored: object) -> bool:
    return (
        isinstance(stored, dict) and cast("dict[str, object]", stored).get(TWO_FACTOR_KEY) is True
    )


async def check_second_factor(
    connection: AsyncConnection, tokens: Mapping[str, Any], tenant_id: uuid.UUID
) -> None:
    if has_second_factor(tokens):
        return
    if await requires_two_factors(connection, tenant_id):
        raise SecondFactorRequiredError
