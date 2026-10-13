import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints
from sqlalchemy import Row, func, insert, literal_column, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import PlatformConnection, TenantConnection
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.tables import (
    SLUG_PATTERN,
    Plan,
    Region,
    TenantKind,
    TenantStatus,
    organisations,
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


async def set_status(
    connection: AsyncConnection, tenant_id: uuid.UUID, status: TenantStatus
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
    return tenant_of(row) if row else await platform_tenant(connection, tenant_id)


async def platform_tenant(connection: AsyncConnection, tenant_id: uuid.UUID) -> Tenant:
    row = (await connection.execute(select(tenants).where(tenants.c.id == tenant_id))).one_or_none()
    if row is None:
        raise NotFoundError("Tenant not found")
    return tenant_of(row)


platform = APIRouter(prefix="/api/platform", tags=["platform"])
tenant = APIRouter(prefix="/api", tags=["tenant"])


@platform.post("/organisations", operation_id="createOrganisation", status_code=201)
async def create_organisation(
    draft: OrganisationDraft, connection: PlatformConnection
) -> Organisation:
    statement = insert(organisations).values(**draft.model_dump()).returning(*organisations.c)
    return organisation_of(await insert_unique(connection, statement))


@platform.get("/organisations", operation_id="listOrganisations")
async def list_organisations(connection: PlatformConnection) -> list[Organisation]:
    rows = await connection.execute(select(organisations).order_by(organisations.c.slug))
    return [organisation_of(row) for row in rows]


@platform.post("/tenants", operation_id="createTenant", status_code=201)
async def create_tenant(draft: TenantDraft, connection: PlatformConnection) -> Tenant:
    organisation = await connection.scalar(
        select(organisations.c.id).where(organisations.c.id == draft.organisation_id)
    )
    if organisation is None:
        raise NotFoundError("Organisation not found")
    statement = insert(tenants).values(**draft.model_dump()).returning(*tenants.c)
    return tenant_of(await insert_unique(connection, statement))


@platform.get("/tenants", operation_id="listTenants")
async def list_tenants(connection: PlatformConnection) -> list[Tenant]:
    rows = await connection.execute(select(tenants).order_by(tenants.c.slug))
    return [tenant_of(row) for row in rows]


@platform.get("/tenants/{tenant_id}", operation_id="getTenant")
async def get_tenant(tenant_id: uuid.UUID, connection: PlatformConnection) -> Tenant:
    return await platform_tenant(connection, tenant_id)


@platform.post("/tenants/{tenant_id}/suspend", operation_id="suspendTenant")
async def suspend_tenant(tenant_id: uuid.UUID, connection: PlatformConnection) -> Tenant:
    return await set_status(connection, tenant_id, TenantStatus.SUSPENDED)


@platform.post("/tenants/{tenant_id}/reactivate", operation_id="reactivateTenant")
async def reactivate_tenant(tenant_id: uuid.UUID, connection: PlatformConnection) -> Tenant:
    return await set_status(connection, tenant_id, TenantStatus.ACTIVE)


@tenant.get("/tenant", operation_id="getCurrentTenant")
async def get_current_tenant(connection: TenantConnection) -> Tenant:
    current = select(tenants).where(tenants.c.id == literal_column(CURRENT_TENANT))
    return tenant_of((await connection.execute(current)).one())
