import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, insert, literal_column, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import API_TOKEN_PREFIX, digest
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, ServiceScope, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.tables import api_tokens, service_accounts
from parfocal_common.db import CURRENT_TENANT

MAX_TOKEN_DAYS = 365
DEFAULT_TOKEN_DAYS = 90

type AccountName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
type TokenDays = Annotated[int, Field(ge=1, le=MAX_TOKEN_DAYS)]


class TokenRequest(BaseModel):
    expires_in_days: TokenDays = DEFAULT_TOKEN_DAYS


class ServiceAccountDraft(TokenRequest):
    name: AccountName
    scopes: Annotated[set[ServiceScope], Field(min_length=1)]


class ApiToken(BaseModel):
    id: uuid.UUID
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


class ServiceAccount(BaseModel):
    id: uuid.UUID
    name: str
    scopes: list[ServiceScope]
    disabled_at: datetime | None
    created_at: datetime
    tokens: list[ApiToken]


class IssuedToken(BaseModel):
    id: uuid.UUID
    token: str
    expires_at: datetime


class CreatedServiceAccount(BaseModel):
    account: ServiceAccount
    token: IssuedToken


class AccountNameTakenError(ConflictError):
    code = "service-account-name-taken"
    title = "A service account with this name already exists"


class AccountDisabledError(ConflictError):
    code = "service-account-disabled"
    title = "This service account is disabled"


router = APIRouter(prefix="/api/tenant/service-accounts", tags=["service-accounts"])

IN_THIS_TENANT = service_accounts.c.tenant_id == literal_column(CURRENT_TENANT)


async def account_of(connection: AsyncConnection, account_id: uuid.UUID) -> ServiceAccount:
    row = (
        await connection.execute(
            select(service_accounts).where(service_accounts.c.id == account_id, IN_THIS_TENANT)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Service account not found")
    tokens = await connection.execute(
        select(api_tokens)
        .where(api_tokens.c.service_account_id == account_id)
        .order_by(api_tokens.c.created_at)
    )
    return ServiceAccount(
        id=row.id,
        name=row.name,
        scopes=sorted(ServiceScope(scope) for scope in row.scopes),
        disabled_at=row.disabled_at,
        created_at=row.created_at,
        tokens=[ApiToken.model_validate(token, from_attributes=True) for token in tokens],
    )


async def issue_token(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    account_id: uuid.UUID,
    days: int,
) -> IssuedToken:
    token = f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    row = (
        await connection.execute(
            insert(api_tokens)
            .values(
                tenant_id=literal_column(CURRENT_TENANT),
                service_account_id=account_id,
                token_hash=digest(token),
                expires_at=func.now() + timedelta(days=days),
            )
            .returning(api_tokens.c.id, api_tokens.c.expires_at)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.API_TOKEN_ISSUED,
        AuditTarget.SERVICE_ACCOUNT,
        account_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"token_id": str(row.id), "expires_in_days": days},
    )
    return IssuedToken(id=row.id, token=token, expires_at=row.expires_at)


@router.get("", operation_id="listServiceAccounts", **require(Permission.INTEGRATIONS))
async def list_service_accounts(connection: TenantConnection) -> list[ServiceAccount]:
    ids = await connection.scalars(
        select(service_accounts.c.id).where(IN_THIS_TENANT).order_by(service_accounts.c.name)
    )
    return [await account_of(connection, account_id) for account_id in ids.all()]


@router.post(
    "",
    operation_id="createServiceAccount",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def create_service_account(
    draft: ServiceAccountDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> CreatedServiceAccount:
    try:
        account_id = await connection.scalar(
            insert(service_accounts)
            .values(
                tenant_id=literal_column(CURRENT_TENANT),
                name=draft.name,
                scopes=sorted(draft.scopes),
            )
            .returning(service_accounts.c.id)
        )
    except IntegrityError as error:
        raise AccountNameTakenError from error
    assert isinstance(account_id, uuid.UUID)
    await record(
        connection,
        actor_of(principal),
        AuditAction.SERVICE_ACCOUNT_CREATED,
        AuditTarget.SERVICE_ACCOUNT,
        account_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"scopes": sorted(draft.scopes)},
    )
    token = await issue_token(connection, principal, account_id, draft.expires_in_days)
    return CreatedServiceAccount(account=await account_of(connection, account_id), token=token)


@router.post(
    "/{account_id}/tokens",
    operation_id="issueApiToken",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def issue_api_token(
    account_id: uuid.UUID,
    request: TokenRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> IssuedToken:
    account = await account_of(connection, account_id)
    if account.disabled_at is not None:
        raise AccountDisabledError
    return await issue_token(connection, principal, account_id, request.expires_in_days)


@router.delete(
    "/{account_id}/tokens/{token_id}",
    operation_id="revokeApiToken",
    status_code=204,
    response_class=Response,
    **require(Permission.INTEGRATIONS, write=True),
)
async def revoke_api_token(
    account_id: uuid.UUID,
    token_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> None:
    await account_of(connection, account_id)
    revoked = await connection.scalar(
        update(api_tokens)
        .where(
            api_tokens.c.id == token_id,
            api_tokens.c.service_account_id == account_id,
            api_tokens.c.revoked_at.is_(None),
        )
        .values(revoked_at=func.now())
        .returning(api_tokens.c.id)
    )
    if revoked is None:
        known = await connection.scalar(
            select(api_tokens.c.id).where(
                api_tokens.c.id == token_id, api_tokens.c.service_account_id == account_id
            )
        )
        if known is None:
            raise NotFoundError("Token not found")
        return
    await record(
        connection,
        actor_of(principal),
        AuditAction.API_TOKEN_REVOKED,
        AuditTarget.SERVICE_ACCOUNT,
        account_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"token_id": str(token_id)},
    )


@router.post(
    "/{account_id}/disable",
    operation_id="disableServiceAccount",
    **require(Permission.INTEGRATIONS, write=True),
)
async def disable_service_account(
    account_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ServiceAccount:
    disabled = await connection.scalar(
        update(service_accounts)
        .where(
            service_accounts.c.id == account_id,
            IN_THIS_TENANT,
            service_accounts.c.disabled_at.is_(None),
        )
        .values(disabled_at=func.now())
        .returning(service_accounts.c.id)
    )
    if disabled is not None:
        await record(
            connection,
            actor_of(principal),
            AuditAction.SERVICE_ACCOUNT_DISABLED,
            AuditTarget.SERVICE_ACCOUNT,
            account_id,
            tenant_id=database_scope(principal).tenant_id,
        )
    return await account_of(connection, account_id)
