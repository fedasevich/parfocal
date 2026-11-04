from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints
from sqlalchemy import literal_column, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import ConflictError
from parfocal_api.tables import workspace_settings
from parfocal_common.db import CURRENT_TENANT

type Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]


class SecurityContactChange(BaseModel):
    email: Email | None


class SecurityContact(BaseModel):
    email: str | None


class SecurityContactMissingError(ConflictError):
    code = "security-contact-missing"
    title = "Set the workspace security contact before it holds clinical data"


router = APIRouter(prefix="/api/tenant/security-contact", tags=["tenant"])

IN_THIS_TENANT = workspace_settings.c.tenant_id == literal_column(CURRENT_TENANT)


async def security_contact_of(connection: AsyncConnection) -> str | None:
    return await connection.scalar(
        select(workspace_settings.c.security_contact).where(IN_THIS_TENANT)
    )


async def require_security_contact(connection: AsyncConnection) -> None:
    if await security_contact_of(connection) is None:
        raise SecurityContactMissingError(
            "A clinical project needs a security contact in the workspace settings"
        )


@router.get("", operation_id="getSecurityContact", **require(Permission.WORKSPACE_SETTINGS))
async def get_security_contact(connection: TenantConnection) -> SecurityContact:
    return SecurityContact(email=await security_contact_of(connection))


@router.put(
    "",
    operation_id="setSecurityContact",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def set_security_contact(
    change: SecurityContactChange, principal: CurrentPrincipal, connection: TenantConnection
) -> SecurityContact:
    before = await security_contact_of(connection)
    if before == change.email:
        return SecurityContact(email=before)
    tenant_id = database_scope(principal).tenant_id
    await connection.execute(
        upsert(workspace_settings)
        .values(tenant_id=tenant_id, security_contact=change.email)
        .on_conflict_do_update(
            index_elements=[workspace_settings.c.tenant_id],
            set_={"security_contact": change.email, "updated_at": literal_column("now()")},
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.SECURITY_CONTACT_CHANGED,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={"had_contact": before is not None, "has_contact": change.email is not None},
    )
    return SecurityContact(email=change.email)
