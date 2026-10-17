import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ForbiddenError
from parfocal_api.tables import Availability, memberships
from parfocal_common.db import CURRENT_TENANT

type Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class AvailabilityChange(BaseModel):
    status: Availability
    until: datetime | None = None
    note: Note | None = None


class MemberAvailability(BaseModel):
    user_id: uuid.UUID
    status: Availability
    until: datetime | None
    note: str | None


class MembersOnlyError(ForbiddenError):
    code = "members-only"
    title = "Only members of this workspace have a status"


class InvalidAvailabilityError(BadRequestError):
    code = "invalid-availability"
    title = "Only away takes an end or a note, and the end must be ahead"


def effective(row: Any, now: datetime) -> MemberAvailability:
    if row.available_again_at is not None and row.available_again_at <= now:
        return MemberAvailability(
            user_id=row.user_id, status=Availability.AVAILABLE, until=None, note=None
        )
    return MemberAvailability(
        user_id=row.user_id,
        status=Availability(row.availability),
        until=row.available_again_at,
        note=row.availability_note,
    )


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
        memberships.c.availability_note,
    ).where(memberships.c.tenant_id == literal_column(CURRENT_TENANT))
    if user_id is not None:
        statement = statement.where(memberships.c.user_id == user_id)
    rows = await connection.execute(statement.order_by(memberships.c.user_id))
    return [effective(row, now) for row in rows]


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
    if change.status is Availability.AVAILABLE and (change.until or change.note):
        raise InvalidAvailabilityError
    await connection.execute(
        update(memberships)
        .where(
            memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            memberships.c.user_id == member.user_id,
        )
        .values(
            availability=change.status,
            available_again_at=change.until,
            availability_note=change.note,
        )
    )
    return (await team_availability(connection, member.user_id))[0]


@team_router.get("", operation_id="listAvailability", **require(Permission.SEE_PEOPLE))
async def list_availability(connection: TenantConnection) -> list[MemberAvailability]:
    return await team_availability(connection)
