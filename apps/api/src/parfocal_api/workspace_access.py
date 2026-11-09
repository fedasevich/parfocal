import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel
from sqlalchemy import exists, func, insert, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import SESSION_COOKIE, digest
from parfocal_api.context import CurrentPrincipal, TenantConnection, engine_of
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, SignedInUser
from parfocal_api.problems import ConflictError, NotFoundError, UnauthenticatedError
from parfocal_api.tables import (
    AccessRequestStatus,
    JoinPolicy,
    NotificationKind,
    Role,
    TenantStatus,
    memberships,
    organisations,
    projects,
    sessions,
    tenants,
    users,
    workspace_access_requests,
)
from parfocal_api.users import (
    PROFILE_COLUMNS,
    Member,
    Workspace,
    logo_colour_of,
    logo_mark_of,
    signed_in,
    tenant_member,
    workspace_of,
)
from parfocal_common.db import CURRENT_TENANT, DatabaseScope, scoped_transaction

PUBLIC_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "yahoo.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "gmx.com",
        "gmx.de",
        "gmx.net",
        "web.de",
        "mail.com",
        "yandex.com",
        "seznam.cz",
        "email.cz",
        "centrum.cz",
        "wp.pl",
        "o2.pl",
        "interia.pl",
        "ukr.net",
        "i.ua",
        "t-online.de",
        "orange.fr",
        "free.fr",
        "libero.it",
    }
)

JOINED_ROLE = Role.REVIEWER


def email_domain_of(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].strip().lower()
    if not domain or domain in PUBLIC_EMAIL_DOMAINS:
        return None
    return domain


class JoinableWorkspace(BaseModel):
    id: uuid.UUID
    name: str
    logo: str
    logo_colour: str
    domain: str
    members: int
    projects: int
    how: JoinPolicy
    asked: bool


class WorkspaceAccessRequest(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    status: AccessRequestStatus
    asked_at: datetime


class PendingAccessRequest(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    initials: str
    avatar_colour: int
    title: str | None
    email: str | None
    asked_at: datetime


class NotJoinableError(NotFoundError):
    code = "workspace-not-joinable"
    title = "There is no such workspace open to your email address"


class AskToJoinError(ConflictError):
    code = "ask-to-join"
    title = "This workspace lets people in only when someone with admin rights says yes"


class AlreadyInWorkspaceError(ConflictError):
    code = "already-in-workspace"
    title = "You are already in this workspace"


class AccessRequestNotFoundError(NotFoundError):
    code = "access-request-not-found"
    title = "There is no such open request to join"


me_router = APIRouter(prefix="/api/me", tags=["me"])
tenant_router = APIRouter(prefix="/api/tenant", tags=["tenant"])


async def domain_of(connection: AsyncConnection, user_id: uuid.UUID) -> str | None:
    return email_domain_of(
        await connection.scalar(select(users.c.email).where(users.c.id == user_id))
    )


def person_scope(
    person: SignedInUser | MemberPrincipal, tenant_id: uuid.UUID | None
) -> DatabaseScope:
    return DatabaseScope(tenant_id=tenant_id, user_id=person.user_id, platform=True, auth=True)


async def is_member(connection: AsyncConnection, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return bool(
        await connection.scalar(
            select(
                exists().where(
                    memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id
                )
            )
        )
    )


async def joinable_tenant(
    connection: AsyncConnection, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> Any:
    domain = await domain_of(connection, user_id)
    row = (
        await connection.execute(
            select(tenants.c.id, tenants.c.name, tenants.c.join_policy).where(
                tenants.c.id == tenant_id,
                tenants.c.status == TenantStatus.ACTIVE,
                tenants.c.email_domain.is_not(None),
                tenants.c.email_domain == domain,
            )
        )
    ).one_or_none()
    if row is None:
        raise NotJoinableError
    if await is_member(connection, tenant_id, user_id):
        raise AlreadyInWorkspaceError
    return row


@me_router.get("/joinable-workspaces", operation_id="listJoinableWorkspaces")
async def list_joinable_workspaces(
    request: Request, principal: CurrentPrincipal
) -> list[JoinableWorkspace]:
    person = signed_in(principal)
    engine = engine_of(request)
    async with scoped_transaction(engine, person_scope(person, None)) as connection:
        domain = await domain_of(connection, person.user_id)
        if domain is None:
            return []
        rows = (
            await connection.execute(
                select(
                    tenants.c.id,
                    tenants.c.name,
                    tenants.c.logo,
                    tenants.c.logo_colour,
                    tenants.c.email_domain,
                    tenants.c.join_policy,
                )
                .where(tenants.c.email_domain == domain, tenants.c.status == TenantStatus.ACTIVE)
                .order_by(tenants.c.join_policy.desc(), tenants.c.name)
            )
        ).all()
    found: list[JoinableWorkspace] = []
    for row in rows:
        async with scoped_transaction(engine, person_scope(person, row.id)) as connection:
            if await is_member(connection, row.id, person.user_id):
                continue
            members = await connection.scalar(
                select(func.count()).where(memberships.c.tenant_id == row.id)
            )
            live = await connection.scalar(
                select(func.count()).where(
                    projects.c.tenant_id == row.id,
                    projects.c.deleted_at.is_(None),
                    projects.c.sample.is_(False),
                )
            )
            asked = await connection.scalar(
                select(
                    exists().where(
                        workspace_access_requests.c.tenant_id == row.id,
                        workspace_access_requests.c.user_id == person.user_id,
                        workspace_access_requests.c.status == AccessRequestStatus.PENDING,
                    )
                )
            )
        found.append(
            JoinableWorkspace(
                id=row.id,
                name=row.name,
                logo=row.logo or logo_mark_of(row.name),
                logo_colour=row.logo_colour or logo_colour_of(row.id),
                domain=row.email_domain,
                members=members or 0,
                projects=live or 0,
                how=JoinPolicy(row.join_policy),
                asked=bool(asked),
            )
        )
    return found


@me_router.post(
    "/joinable-workspaces/{tenant_id}/membership",
    operation_id="joinWorkspace",
    status_code=201,
)
async def join_workspace(
    tenant_id: uuid.UUID, request: Request, principal: CurrentPrincipal
) -> Workspace:
    person = signed_in(principal)
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise UnauthenticatedError
    async with scoped_transaction(
        engine_of(request), person_scope(person, tenant_id)
    ) as connection:
        tenant = await joinable_tenant(connection, tenant_id, person.user_id)
        if tenant.join_policy != JoinPolicy.JOIN:
            raise AskToJoinError
        await connection.execute(
            insert(memberships).values(
                tenant_id=tenant_id, user_id=person.user_id, role=JOINED_ROLE, admin_rights=False
            )
        )
        await record(
            connection,
            actor_of(principal),
            AuditAction.MEMBER_ADDED,
            AuditTarget.PERSON,
            person=person.subject,
            tenant_id=tenant_id,
            details={"role": JOINED_ROLE.value, "admin_rights": False, "through": "email-domain"},
        )
        await connection.execute(
            update(sessions)
            .where(sessions.c.id_hash == digest(session_id))
            .values(active_tenant_id=tenant_id)
        )
        await connection.execute(
            update(users).where(users.c.id == person.user_id).values(last_tenant_id=tenant_id)
        )
        row = (
            await connection.execute(
                select(
                    tenants.c.id.label("tenant_id"),
                    memberships.c.role,
                    memberships.c.admin_rights,
                    tenants.c.slug,
                    tenants.c.name,
                    tenants.c.kind,
                    tenants.c.status,
                    organisations.c.name.label("organisation_name"),
                    tenants.c.logo,
                    tenants.c.logo_colour,
                )
                .join(memberships, memberships.c.tenant_id == tenants.c.id)
                .join(organisations, organisations.c.id == tenants.c.organisation_id)
                .where(tenants.c.id == tenant_id, memberships.c.user_id == person.user_id)
            )
        ).one()
    return workspace_of(row)


@me_router.post(
    "/joinable-workspaces/{tenant_id}/access-requests",
    operation_id="askToJoinWorkspace",
    status_code=201,
)
async def ask_to_join_workspace(
    tenant_id: uuid.UUID,
    request: Request,
    background: BackgroundTasks,
    principal: CurrentPrincipal,
) -> WorkspaceAccessRequest:
    person = signed_in(principal)
    async with scoped_transaction(
        engine_of(request), person_scope(person, tenant_id)
    ) as connection:
        await joinable_tenant(connection, tenant_id, person.user_id)
        row = (
            await connection.execute(
                upsert(workspace_access_requests)
                .values(tenant_id=tenant_id, user_id=person.user_id)
                .on_conflict_do_nothing(
                    index_elements=["tenant_id", "user_id"],
                    index_where=workspace_access_requests.c.status == AccessRequestStatus.PENDING,
                )
                .returning(*workspace_access_requests.c)
            )
        ).one_or_none()
        if row is None:
            existing = (
                await connection.execute(
                    select(workspace_access_requests).where(
                        workspace_access_requests.c.tenant_id == tenant_id,
                        workspace_access_requests.c.user_id == person.user_id,
                        workspace_access_requests.c.status == AccessRequestStatus.PENDING,
                    )
                )
            ).one()
            return WorkspaceAccessRequest.model_validate(existing, from_attributes=True)
        await record(
            connection,
            actor_of(principal),
            AuditAction.WORKSPACE_ACCESS_ASKED,
            AuditTarget.ACCESS_REQUEST,
            row.id,
            person=person.subject,
            tenant_id=tenant_id,
        )
        admins = await connection.scalars(
            select(memberships.c.user_id).where(
                memberships.c.tenant_id == tenant_id, memberships.c.admin_rights.is_(True)
            )
        )
        await notify(
            connection,
            tenant_id,
            admins.all(),
            NotificationKind.WORKSPACE_ACCESS_ASKED,
            AuditTarget.ACCESS_REQUEST,
            row.id,
            {"user_id": str(person.user_id)},
        )
    background.add_task(deliver_after_commit, request.app, tenant_id)
    return WorkspaceAccessRequest.model_validate(row, from_attributes=True)


@tenant_router.get(
    "/access-requests",
    operation_id="listWorkspaceAccessRequests",
    **require(Permission.MANAGE_PEOPLE),
)
async def list_workspace_access_requests(
    connection: TenantConnection,
) -> list[PendingAccessRequest]:
    rows = await connection.execute(
        select(
            workspace_access_requests.c.id,
            *PROFILE_COLUMNS,
            users.c.email,
            workspace_access_requests.c.asked_at,
        )
        .join(users, users.c.id == workspace_access_requests.c.user_id)
        .where(
            workspace_access_requests.c.tenant_id == literal_column(CURRENT_TENANT),
            workspace_access_requests.c.status == AccessRequestStatus.PENDING,
        )
        .order_by(workspace_access_requests.c.asked_at)
    )
    return [PendingAccessRequest.model_validate(row, from_attributes=True) for row in rows]


@tenant_router.post(
    "/access-requests/{request_id}/approval",
    operation_id="approveWorkspaceAccessRequest",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def approve_workspace_access_request(
    request_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Member:
    assert isinstance(principal, MemberPrincipal)
    asked = (
        await connection.execute(
            select(workspace_access_requests.c.user_id, users.c.subject)
            .join(users, users.c.id == workspace_access_requests.c.user_id)
            .where(
                workspace_access_requests.c.id == request_id,
                workspace_access_requests.c.status == AccessRequestStatus.PENDING,
            )
            .with_for_update(of=workspace_access_requests)
        )
    ).one_or_none()
    if asked is None:
        raise AccessRequestNotFoundError
    await connection.execute(
        update(workspace_access_requests)
        .where(workspace_access_requests.c.id == request_id)
        .values(
            status=AccessRequestStatus.APPROVED,
            decided_at=func.now(),
            decided_by_user_id=principal.user_id,
        )
    )
    added = await connection.scalar(
        upsert(memberships)
        .values(
            tenant_id=principal.tenant_id,
            user_id=asked.user_id,
            role=JOINED_ROLE,
            admin_rights=False,
        )
        .on_conflict_do_nothing(index_elements=["tenant_id", "user_id"])
        .returning(memberships.c.id)
    )
    actor = actor_of(principal)
    await record(
        connection,
        actor,
        AuditAction.WORKSPACE_ACCESS_APPROVED,
        AuditTarget.ACCESS_REQUEST,
        request_id,
        person=asked.subject,
        tenant_id=principal.tenant_id,
    )
    if added is not None:
        await record(
            connection,
            actor,
            AuditAction.MEMBER_ADDED,
            AuditTarget.PERSON,
            person=asked.subject,
            tenant_id=principal.tenant_id,
            details={"role": JOINED_ROLE.value, "admin_rights": False, "through": "access-request"},
        )
    return await tenant_member(connection, asked.user_id)
