import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.sso_provisioning import PLATFORM, NoIdpOrganisationError
from parfocal_api.tables import tenants
from parfocal_api.tenant_provisioning import idp_organisation_name
from parfocal_api.zitadel_directory import ZitadelDirectory
from parfocal_common.db import scoped_transaction

SCIM_ROLES = ["ORG_USER_MANAGER"]
DEFAULT_TOKEN_DAYS = 365
MAX_TOKEN_DAYS = 730


@dataclass(frozen=True)
class ScimConnectionRequest:
    tenant_id: uuid.UUID
    issuer: str
    token_days: int = DEFAULT_TOKEN_DAYS


@dataclass(frozen=True)
class ScimConnection:
    tenant_id: uuid.UUID
    endpoint: str
    machine_user_id: str
    token: str
    expires_at: datetime


def scim_user_name(slug: str) -> str:
    return f"scim-{slug}"


def scim_endpoint(issuer: str, organisation_id: str) -> str:
    return f"{issuer.rstrip('/')}/scim/v2/{organisation_id}"


async def connect_scim(
    engine: AsyncEngine, directory: ZitadelDirectory, request: ScimConnectionRequest
) -> ScimConnection:
    if not 1 <= request.token_days <= MAX_TOKEN_DAYS:
        raise LookupError(f"--token-days takes 1 to {MAX_TOKEN_DAYS} days")
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant = (
            await connection.execute(
                select(tenants.c.slug, tenants.c.name).where(tenants.c.id == request.tenant_id)
            )
        ).one_or_none()
    if tenant is None:
        raise LookupError(f"No tenant {request.tenant_id}")
    organisation_name = idp_organisation_name(tenant.slug)
    organisation_id = await directory.find_organisation(organisation_name)
    if organisation_id is None:
        raise NoIdpOrganisationError(organisation_name)
    user_id = await directory.ensure_machine_user(
        organisation_id, scim_user_name(tenant.slug), f"{tenant.name} SCIM"
    )
    await directory.grant_organisation_roles(organisation_id, user_id, SCIM_ROLES)
    expires_at = (datetime.now(UTC) + timedelta(days=request.token_days)).replace(microsecond=0)
    token = await directory.issue_personal_token(organisation_id, user_id, expires_at)
    return ScimConnection(
        tenant_id=request.tenant_id,
        endpoint=scim_endpoint(request.issuer, organisation_id),
        machine_user_id=user_id,
        token=token,
        expires_at=expires_at,
    )
