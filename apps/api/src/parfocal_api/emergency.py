import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints
from sqlalchemy import exists, func, insert, select

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.tables import cases, emergency_grants
from parfocal_api.tenants import current_policy

type Reason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)
]


class EmergencyRequest(BaseModel):
    reason: Reason


class EmergencyGrant(BaseModel):
    case_id: uuid.UUID
    expires_at: datetime


router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.post(
    "/{case_id}/emergency-access",
    operation_id="requestEmergencyAccess",
    status_code=201,
    **require(Permission.EMERGENCY_ACCESS, write=True),
)
async def request_emergency_access(
    case_id: uuid.UUID,
    request: EmergencyRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> EmergencyGrant:
    if not isinstance(principal, MemberPrincipal):
        raise ForbiddenError
    found = await connection.scalar(
        select(exists().where(cases.c.id == case_id, cases.c.deleted_at.is_(None)))
    )
    if not found:
        raise NotFoundError("Case not found")
    hours = (await current_policy(connection)).emergency_hours
    expires_at = await connection.scalar(
        insert(emergency_grants)
        .values(
            tenant_id=principal.tenant_id,
            user_id=principal.user_id,
            case_id=case_id,
            reason=request.reason,
            expires_at=func.now() + timedelta(hours=hours),
        )
        .returning(emergency_grants.c.expires_at)
    )
    assert isinstance(expires_at, datetime)
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_EMERGENCY_ACCESS,
        AuditTarget.CASE,
        case_id,
        tenant_id=principal.tenant_id,
        details={"reason": request.reason, "hours": hours, "role": principal.role},
    )
    return EmergencyGrant(case_id=case_id, expires_at=expires_at)
