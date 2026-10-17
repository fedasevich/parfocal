import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.permissions import Grant, Permission, grant_for
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import emergency_grants


class EmergencyAccessNeededError(ForbiddenError):
    code = "emergency-access-needed"
    title = "Give a reason to open this case"


async def has_emergency_grant(
    connection: AsyncConnection, principal: MemberPrincipal, case_id: uuid.UUID
) -> bool:
    return bool(
        await connection.scalar(
            select(
                exists().where(
                    emergency_grants.c.user_id == principal.user_id,
                    emergency_grants.c.case_id == case_id,
                    emergency_grants.c.expires_at > func.now(),
                )
            )
        )
    )


async def require_case_access(
    connection: AsyncConnection, principal: Principal, case_id: uuid.UUID, permission: Permission
) -> None:
    if not isinstance(principal, MemberPrincipal):
        return
    if grant_for(principal.role, permission) is not Grant.NONE:
        return
    if not await has_emergency_grant(connection, principal, case_id):
        raise EmergencyAccessNeededError
