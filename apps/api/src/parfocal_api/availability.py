import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ForbiddenError
from parfocal_api.tables import Availability, memberships
from parfocal_common.db import CURRENT_TENANT

LONGEST_BUSY = timedelta(hours=24)


class AvailabilityChange(BaseModel):
    status: Availability
    until: datetime | None = None
    backup_user_id: uuid.UUID | None = None


class MemberAvailability(BaseModel):
    user_id: uuid.UUID
    status: Availability
    until: datetime | None
    backup_user_id: uuid.UUID | None


class MembersOnlyError(ForbiddenError):
    code = "members-only"
    title = "Only members of this workspace have a status"


class InvalidAvailabilityError(BadRequestError):
    code = "invalid-availability"
    title = "Busy needs an end within 24 hours, away needs a back-up, and any end must be ahead"


class InvalidBackupError(BadRequestError):
    code = "invalid-backup"
    title = "The back-up must be another member of this workspace who is not away"


def effective(
    status: Availability,
    until: datetime | None,
    backup_user_id: uuid.UUID | None,
    now: datetime,
) -> tuple[Availability, datetime | None, uuid.UUID | None]:
    if until is not None and until <= now:
        return Availability.AVAILABLE, None, None
    return status, until, backup_user_id


def member_of(principal: Principal) -> MemberPrincipal:
    if not isinstance(principal, MemberPrincipal):
        raise MembersOnlyError
    return principal


async def team_availability(
    connection: AsyncConnection, user_id: uuid.UUID | None = None
) -> list[MemberAvailability]:
    now = await connection.scalar(select(func.now()))
    assert isinstance(now, datetime)
    statement = select(
        memberships.c.user_id,
        memberships.c.availability,
        memberships.c.available_again_at,
        memberships.c.backup_user_id,
    ).where(memberships.c.tenant_id == literal_column(CURRENT_TENANT))
    if user_id is not None:
        statement = statement.where(memberships.c.user_id == user_id)
    rows = (await connection.execute(statement.order_by(memberships.c.user_id))).all()
    found: list[MemberAvailability] = []
    for row in rows:
        status, until, backup = effective(
            Availability(row.availability), row.available_again_at, row.backup_user_id, now
        )
        found.append(
            MemberAvailability(
                user_id=row.user_id, status=status, until=until, backup_user_id=backup
            )
        )
    return found


async def covering(connection: AsyncConnection, user_id: uuid.UUID | None) -> uuid.UUID | None:
    if user_id is None:
        return None
    found = await team_availability(connection, user_id)
    if found and found[0].status is Availability.AWAY:
        return found[0].backup_user_id
    return user_id


me_router = APIRouter(prefix="/api/me", tags=["me"])
team_router = APIRouter(prefix="/api/tenant/availability", tags=["tenant"])


@me_router.get("/availability", operation_id="getMyAvailability")
async def get_my_availability(
    principal: CurrentPrincipal, connection: TenantConnection
) -> MemberAvailability:
    member = member_of(principal)
    return (await team_availability(connection, member.user_id))[0]


@me_router.put("/availability", operation_id="setMyAvailability")
async def set_my_availability(
    change: AvailabilityChange, principal: CurrentPrincipal, connection: TenantConnection
) -> MemberAvailability:
    member = member_of(principal)
    now = await connection.scalar(select(func.now()))
    assert isinstance(now, datetime)
    if change.until is not None and change.until <= now:
        raise InvalidAvailabilityError
    match change.status:
        case Availability.AVAILABLE:
            if change.until is not None or change.backup_user_id is not None:
                raise InvalidAvailabilityError
        case Availability.BUSY:
            if change.until is None or change.until > now + LONGEST_BUSY:
                raise InvalidAvailabilityError
            if change.backup_user_id is not None:
                raise InvalidAvailabilityError
        case Availability.AWAY:
            if change.backup_user_id is None:
                raise InvalidAvailabilityError
            if change.backup_user_id == member.user_id:
                raise InvalidBackupError
            backup = await team_availability(connection, change.backup_user_id)
            if not backup or backup[0].status is Availability.AWAY:
                raise InvalidBackupError
    await connection.execute(
        update(memberships)
        .where(
            memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            memberships.c.user_id == member.user_id,
        )
        .values(
            availability=change.status,
            available_again_at=change.until,
            backup_user_id=change.backup_user_id,
        )
    )
    return (await team_availability(connection, member.user_id))[0]


@team_router.get("", operation_id="listAvailability", **require(Permission.SEE_TEAM))
async def list_availability(connection: TenantConnection) -> list[MemberAvailability]:
    return await team_availability(connection)
