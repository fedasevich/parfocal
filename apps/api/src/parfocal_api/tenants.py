import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Row, func, insert, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, PlatformConnection, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.tables import (
    DEFAULT_IDLE_LOCK_MINUTES,
    DEFAULT_SESSION_HOURS,
    SLUG_PATTERN,
    Plan,
    Region,
    TenantKind,
    TenantStatus,
    organisations,
    session_policies,
    tenants,
)
from parfocal_common.db import CURRENT_TENANT

UNIQUE_VIOLATION = "23505"

type Slug = Annotated[str, StringConstraints(pattern=SLUG_PATTERN)]
type Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class OrganisationDraft(BaseModel):
    slug: Slug
    name: Name


class Organisation(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    created_at: datetime


class TenantDraft(BaseModel):
    organisation_id: uuid.UUID
    slug: Slug
    name: Name
    kind: TenantKind
    region: Region
    plan: Plan = Plan.PILOT


class Tenant(BaseModel):
    id: uuid.UUID
    organisation_id: uuid.UUID
    slug: str
    name: str
    kind: TenantKind
    region: Region
    plan: Plan
    status: TenantStatus
    suspended_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SlugTakenError(ConflictError):
    code = "slug-taken"
    title = "This slug is already in use"


def organisation_of(row: Row[Any]) -> Organisation:
    return Organisation.model_validate(row, from_attributes=True)


def tenant_of(row: Row[Any]) -> Tenant:
    return Tenant.model_validate(row, from_attributes=True)


async def insert_unique(connection: AsyncConnection, statement: Any) -> Row[Any]:
    try:
        return (await connection.execute(statement)).one()
    except IntegrityError as error:
        if getattr(error.orig, "sqlstate", None) == UNIQUE_VIOLATION:
            raise SlugTakenError from error
        raise


STATUS_ACTIONS = {
    TenantStatus.SUSPENDED: AuditAction.TENANT_SUSPENDED,
    TenantStatus.ACTIVE: AuditAction.TENANT_REACTIVATED,
}


async def set_status(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    tenant_id: uuid.UUID,
    status: TenantStatus,
) -> Tenant:
    suspended_at = func.now() if status is TenantStatus.SUSPENDED else None
    row = (
        await connection.execute(
            update(tenants)
            .where(tenants.c.id == tenant_id, tenants.c.status != status)
            .values(status=status, suspended_at=suspended_at)
            .returning(*tenants.c)
        )
    ).one_or_none()
    if row is None:
        return await platform_tenant(connection, tenant_id)
    await record(
        connection,
        actor_of(principal),
        STATUS_ACTIONS[status],
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
    )
    return tenant_of(row)


async def platform_tenant(connection: AsyncConnection, tenant_id: uuid.UUID) -> Tenant:
    row = (await connection.execute(select(tenants).where(tenants.c.id == tenant_id))).one_or_none()
    if row is None:
        raise NotFoundError("Tenant not found")
    return tenant_of(row)


platform = APIRouter(prefix="/api/platform", tags=["platform"])
tenant = APIRouter(prefix="/api", tags=["tenant"])


@platform.post("/organisations", operation_id="createOrganisation", status_code=201)
async def create_organisation(
    draft: OrganisationDraft, principal: CurrentPrincipal, connection: PlatformConnection
) -> Organisation:
    statement = insert(organisations).values(**draft.model_dump()).returning(*organisations.c)
    organisation = organisation_of(await insert_unique(connection, statement))
    await record(
        connection,
        actor_of(principal),
        AuditAction.ORGANISATION_CREATED,
        AuditTarget.ORGANISATION,
        organisation.id,
    )
    return organisation


@platform.get("/organisations", operation_id="listOrganisations")
async def list_organisations(connection: PlatformConnection) -> list[Organisation]:
    rows = await connection.execute(select(organisations).order_by(organisations.c.slug))
    return [organisation_of(row) for row in rows]


@platform.post("/tenants", operation_id="createTenant", status_code=201)
async def create_tenant(
    draft: TenantDraft, principal: CurrentPrincipal, connection: PlatformConnection
) -> Tenant:
    organisation = await connection.scalar(
        select(organisations.c.id).where(organisations.c.id == draft.organisation_id)
    )
    if organisation is None:
        raise NotFoundError("Organisation not found")
    statement = insert(tenants).values(**draft.model_dump()).returning(*tenants.c)
    created = tenant_of(await insert_unique(connection, statement))
    await record(
        connection,
        actor_of(principal),
        AuditAction.TENANT_CREATED,
        AuditTarget.TENANT,
        created.id,
        tenant_id=created.id,
    )
    return created


@platform.get("/tenants", operation_id="listTenants")
async def list_tenants(connection: PlatformConnection) -> list[Tenant]:
    rows = await connection.execute(select(tenants).order_by(tenants.c.slug))
    return [tenant_of(row) for row in rows]


@platform.get("/tenants/{tenant_id}", operation_id="getTenant")
async def get_tenant(tenant_id: uuid.UUID, connection: PlatformConnection) -> Tenant:
    return await platform_tenant(connection, tenant_id)


@platform.post("/tenants/{tenant_id}/suspend", operation_id="suspendTenant")
async def suspend_tenant(
    tenant_id: uuid.UUID, principal: CurrentPrincipal, connection: PlatformConnection
) -> Tenant:
    return await set_status(connection, principal, tenant_id, TenantStatus.SUSPENDED)


@platform.post("/tenants/{tenant_id}/reactivate", operation_id="reactivateTenant")
async def reactivate_tenant(
    tenant_id: uuid.UUID, principal: CurrentPrincipal, connection: PlatformConnection
) -> Tenant:
    return await set_status(connection, principal, tenant_id, TenantStatus.ACTIVE)


@tenant.get("/tenant", operation_id="getCurrentTenant")
async def get_current_tenant(connection: TenantConnection) -> Tenant:
    current = select(tenants).where(tenants.c.id == literal_column(CURRENT_TENANT))
    return tenant_of((await connection.execute(current)).one())


class SessionPolicyChange(BaseModel):
    idle_lock_minutes: Annotated[int, Field(ge=1, le=240)]
    session_hours: Annotated[int, Field(ge=1, le=24)]


class SessionPolicy(SessionPolicyChange):
    tenant_id: uuid.UUID


async def current_policy(connection: AsyncConnection) -> SessionPolicy:
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    assert isinstance(tenant_id, uuid.UUID)
    row = (
        await connection.execute(
            select(session_policies.c.idle_lock_minutes, session_policies.c.session_hours).where(
                session_policies.c.tenant_id == tenant_id
            )
        )
    ).one_or_none()
    return SessionPolicy(
        tenant_id=tenant_id,
        idle_lock_minutes=row.idle_lock_minutes if row else DEFAULT_IDLE_LOCK_MINUTES,
        session_hours=row.session_hours if row else DEFAULT_SESSION_HOURS,
    )


@tenant.get("/tenant/session-policy", operation_id="getSessionPolicy")
async def get_session_policy(connection: TenantConnection) -> SessionPolicy:
    return await current_policy(connection)


@tenant.put(
    "/tenant/session-policy",
    operation_id="updateSessionPolicy",
    **require(Permission.LAB_SETUP, write=True),
)
async def update_session_policy(
    change: SessionPolicyChange, principal: CurrentPrincipal, connection: TenantConnection
) -> SessionPolicy:
    previous = await current_policy(connection)
    policy = SessionPolicy(tenant_id=previous.tenant_id, **change.model_dump())
    if previous != policy:
        await connection.execute(
            upsert(session_policies)
            .values(tenant_id=previous.tenant_id, **change.model_dump())
            .on_conflict_do_update(
                index_elements=[session_policies.c.tenant_id], set_=change.model_dump()
            )
        )
        await record(
            connection,
            actor_of(principal),
            AuditAction.SESSION_POLICY_CHANGED,
            AuditTarget.TENANT,
            previous.tenant_id,
            tenant_id=previous.tenant_id,
            details={
                "from": previous.model_dump(exclude={"tenant_id"}),
                "to": change.model_dump(),
            },
        )
    return policy
