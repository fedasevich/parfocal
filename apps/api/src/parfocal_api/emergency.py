import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, insert, select

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ConflictError, ForbiddenError
from parfocal_api.project_access import role_in
from parfocal_api.projects import row_of
from parfocal_api.tables import (
    NotificationKind,
    PrivacyMode,
    ProjectRole,
    emergency_grants,
    project_members,
)
from parfocal_api.tenants import current_policy

type Reason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)
]


class EmergencyRequest(BaseModel):
    reason: Reason


class EmergencyGrant(BaseModel):
    project_id: uuid.UUID
    expires_at: datetime


class NoEmergencyAccessError(ConflictError):
    code = "no-emergency-access"
    title = "A de-identified project holds no patient data and has no emergency access"


class AlreadyInProjectError(ConflictError):
    code = "already-in-project"
    title = "You are in this project and need no emergency access"


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post(
    "/{project_id}/emergency-access",
    operation_id="requestEmergencyAccess",
    status_code=201,
    **require(Permission.EMERGENCY_ACCESS, write=True),
)
async def request_emergency_access(
    project_id: uuid.UUID,
    request: EmergencyRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> EmergencyGrant:
    if not isinstance(principal, MemberPrincipal):
        raise ForbiddenError
    project = await row_of(connection, project_id)
    if project.privacy_mode != PrivacyMode.CLINICAL:
        raise NoEmergencyAccessError
    if await role_in(connection, principal, project_id) is not None:
        raise AlreadyInProjectError
    hours = (await current_policy(connection)).emergency_hours
    expires_at = await connection.scalar(
        insert(emergency_grants)
        .values(
            tenant_id=principal.tenant_id,
            user_id=principal.user_id,
            project_id=project_id,
            reason=request.reason,
            expires_at=func.now() + timedelta(hours=hours),
        )
        .returning(emergency_grants.c.expires_at)
    )
    assert isinstance(expires_at, datetime)
    await record(
        connection,
        actor_of(principal),
        AuditAction.PROJECT_EMERGENCY_ACCESS,
        AuditTarget.PROJECT,
        project_id,
        tenant_id=principal.tenant_id,
        details={"reason": request.reason, "hours": hours, "role": principal.role},
    )
    owners = await connection.scalars(
        select(project_members.c.user_id).where(
            project_members.c.project_id == project_id,
            project_members.c.role == ProjectRole.OWNER,
        )
    )
    await notify(
        connection,
        principal.tenant_id,
        owners.all(),
        NotificationKind.EMERGENCY_ACCESS,
        AuditTarget.PROJECT,
        project_id,
        {"hours": hours},
    )
    background.add_task(deliver_after_commit, http.app, principal.tenant_id)
    return EmergencyGrant(project_id=project_id, expires_at=expires_at)
