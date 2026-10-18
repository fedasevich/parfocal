import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any, cast

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import Row, exists, func, insert, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import AUTH_SCOPE, SESSION_COOKIE, auth_state, digest
from parfocal_api.context import CurrentPrincipal, PlatformConnection, TenantConnection
from parfocal_api.email_templates import render
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import (
    ConflictError,
    NotFoundError,
    ProblemError,
    TenantSuspendedError,
)
from parfocal_api.tables import (
    Role,
    TenantStatus,
    invitations,
    memberships,
    sessions,
    tenants,
    users,
)
from parfocal_api.users import (
    AlreadyAMemberError,
    Workspace,
    own_workspaces,
    signed_in,
)
from parfocal_common.clients import Clients, EmailMessage
from parfocal_common.db import CURRENT_TENANT, DatabaseScope, scoped_transaction

INVITATION_LIFETIME = timedelta(days=7)
INVITATION_TEMPLATE = "invitation"

type Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]


class InvitationDraft(BaseModel):
    email: Email
    role: Role


class Invitation(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role: Role
    expires_at: datetime
    created_at: datetime
    expired: bool


class InvitationToken(BaseModel):
    token: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class InvitationNotFoundError(NotFoundError):
    code = "invitation-not-found"
    title = "This invitation does not exist or was withdrawn"


class InvitationUsedError(ConflictError):
    code = "invitation-used"
    title = "This invitation has already been accepted"


class InvitationForSomeoneElseError(ProblemError):
    status = 403
    code = "invitation-for-someone-else"
    title = "This invitation was sent to a different email address"


class InvitationExpiredError(ProblemError):
    status = 410
    code = "invitation-expired"
    title = "This invitation has expired. Ask for a new one"


tenant_router = APIRouter(prefix="/api/tenant/invitations", tags=["invitations"])
platform_router = APIRouter(prefix="/api/platform", tags=["platform"])
public_router = APIRouter(prefix="/api/invitations", tags=["invitations"])


def invitation_of(row: Row[Any]) -> Invitation:
    return Invitation.model_validate(row, from_attributes=True)


EXPIRED = (invitations.c.expires_at <= func.now()).label("expired")
PENDING = (invitations.c.accepted_at.is_(None), invitations.c.revoked_at.is_(None))


def clients_of(request: Request) -> Clients:
    return cast("Clients", request.app.clients)


async def invite(
    connection: AsyncConnection,
    request: Request,
    principal: CurrentPrincipal,
    tenant_id: uuid.UUID,
    draft: InvitationDraft,
) -> Invitation:
    already = await connection.scalar(
        select(
            exists()
            .where(memberships.c.tenant_id == tenant_id)
            .where(memberships.c.user_id == users.c.id)
            .where(func.lower(users.c.email) == draft.email)
        )
    )
    if already:
        raise AlreadyAMemberError
    replaced = await connection.scalars(
        update(invitations)
        .where(invitations.c.tenant_id == tenant_id, invitations.c.email == draft.email, *PENDING)
        .values(revoked_at=func.now())
        .returning(invitations.c.id)
    )
    actor = actor_of(principal)
    for invitation_id in replaced.all():
        await record(
            connection,
            actor,
            AuditAction.INVITATION_REVOKED,
            AuditTarget.INVITATION,
            invitation_id,
            tenant_id=tenant_id,
            details={"reason": "replaced"},
        )
    token = secrets.token_urlsafe(32)
    row = (
        await connection.execute(
            insert(invitations)
            .values(
                tenant_id=tenant_id,
                email=draft.email,
                role=draft.role,
                token_hash=digest(token),
                expires_at=func.now() + INVITATION_LIFETIME,
            )
            .returning(*invitations.c, EXPIRED)
        )
    ).one()
    await record(
        connection,
        actor,
        AuditAction.INVITATION_CREATED,
        AuditTarget.INVITATION,
        row.id,
        tenant_id=tenant_id,
        details={"role": draft.role},
    )
    link = f"{auth_state(request).public_origin}/invitations/{token}"
    workspace = await connection.scalar(select(tenants.c.name).where(tenants.c.id == tenant_id))
    rendered = render(INVITATION_TEMPLATE, {"workspace_name": str(workspace), "link": link})
    clients_of(request).email.send(
        EmailMessage(
            to=draft.email,
            template=INVITATION_TEMPLATE,
            link=link,
            subject=rendered.subject,
            text=rendered.text,
            html=rendered.html,
        )
    )
    return invitation_of(row)


@tenant_router.get("", operation_id="listInvitations", **require(Permission.MANAGE_PEOPLE))
async def list_invitations(connection: TenantConnection) -> list[Invitation]:
    rows = await connection.execute(
        select(*invitations.c, EXPIRED)
        .where(invitations.c.tenant_id == literal_column(CURRENT_TENANT), *PENDING)
        .order_by(invitations.c.created_at)
    )
    return [invitation_of(row) for row in rows]


@tenant_router.post(
    "",
    operation_id="createInvitation",
    status_code=201,
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def create_invitation(
    draft: InvitationDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Invitation:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    return await invite(connection, request, principal, tenant_id, draft)


@tenant_router.delete(
    "/{invitation_id}",
    operation_id="revokeInvitation",
    status_code=204,
    response_class=Response,
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def revoke_invitation(
    invitation_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    revoked = await connection.scalar(
        update(invitations)
        .where(
            invitations.c.id == invitation_id,
            invitations.c.tenant_id == literal_column(CURRENT_TENANT),
            *PENDING,
        )
        .values(revoked_at=func.now())
        .returning(invitations.c.id)
    )
    if revoked is None:
        raise InvitationNotFoundError
    await record(
        connection,
        actor_of(principal),
        AuditAction.INVITATION_REVOKED,
        AuditTarget.INVITATION,
        invitation_id,
        tenant_id=database_scope(principal).tenant_id,
    )


@platform_router.post(
    "/tenants/{tenant_id}/invitations", operation_id="invitePlatformMember", status_code=201
)
async def invite_platform_member(
    tenant_id: uuid.UUID,
    draft: InvitationDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: PlatformConnection,
) -> Invitation:
    if not await connection.scalar(select(exists().where(tenants.c.id == tenant_id))):
        raise NotFoundError("Tenant not found")
    return await invite(connection, request, principal, tenant_id, draft)


@public_router.post("/accept", operation_id="acceptInvitation")
async def accept_invitation(
    body: InvitationToken, request: Request, principal: CurrentPrincipal
) -> Workspace:
    person = signed_in(principal)
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        tenant_id = await connection.scalar(
            select(invitations.c.tenant_id).where(invitations.c.token_hash == digest(body.token))
        )
    if tenant_id is None:
        raise InvitationNotFoundError
    scope = DatabaseScope(tenant_id=tenant_id, user_id=person.user_id, auth=True)
    async with scoped_transaction(state.engine, scope) as connection:
        invitation = (
            await connection.execute(
                select(*invitations.c, EXPIRED)
                .where(invitations.c.token_hash == digest(body.token))
                .with_for_update(of=invitations)
            )
        ).one()
        if invitation.revoked_at is not None:
            raise InvitationNotFoundError
        if invitation.accepted_at is not None:
            raise InvitationUsedError
        status = await connection.scalar(select(tenants.c.status).where(tenants.c.id == tenant_id))
        if status == TenantStatus.SUSPENDED:
            raise TenantSuspendedError
        actor = actor_of(principal)
        if invitation.expired:
            await record(
                connection,
                actor,
                AuditAction.INVITATION_EXPIRED,
                AuditTarget.INVITATION,
                invitation.id,
                tenant_id=tenant_id,
            )
        else:
            email = await connection.scalar(
                select(users.c.email).where(users.c.id == person.user_id)
            )
            if email is None or email.lower() != invitation.email:
                raise InvitationForSomeoneElseError
            member = await connection.scalar(
                select(
                    exists().where(
                        memberships.c.tenant_id == tenant_id,
                        memberships.c.user_id == person.user_id,
                    )
                )
            )
            if member:
                raise AlreadyAMemberError
            await connection.execute(
                insert(memberships).values(
                    tenant_id=tenant_id, user_id=person.user_id, role=invitation.role
                )
            )
            await connection.execute(
                update(invitations)
                .where(invitations.c.id == invitation.id)
                .values(accepted_at=func.now())
            )
            await connection.execute(
                update(sessions)
                .where(sessions.c.id_hash == digest(request.cookies.get(SESSION_COOKIE, "")))
                .values(active_tenant_id=tenant_id)
            )
            await connection.execute(
                update(users).where(users.c.id == person.user_id).values(last_tenant_id=tenant_id)
            )
            await record(
                connection,
                actor,
                AuditAction.INVITATION_ACCEPTED,
                AuditTarget.INVITATION,
                invitation.id,
                tenant_id=tenant_id,
            )
            await record(
                connection,
                actor,
                AuditAction.MEMBER_ADDED,
                AuditTarget.PERSON,
                person=person.subject,
                tenant_id=tenant_id,
                details={"role": invitation.role, "invitation_id": str(invitation.id)},
            )
            return next(
                workspace
                for workspace in await own_workspaces(connection, person.user_id)
                if workspace.tenant_id == tenant_id
            )
    raise InvitationExpiredError
