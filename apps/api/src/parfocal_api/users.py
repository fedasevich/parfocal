import uuid
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import exists, insert, literal_column, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.auth import AUTH_SCOPE, SESSION_COOKIE, auth_state, digest
from parfocal_api.context import (
    CurrentPrincipal,
    PlatformConnection,
    TenantConnection,
    UserConnection,
)
from parfocal_api.principals import MemberPrincipal, SignedInUser
from parfocal_api.problems import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TenantSuspendedError,
    UnauthenticatedError,
)
from parfocal_api.tables import (
    AVATAR_COLOURS,
    TenantKind,
    TenantStatus,
    memberships,
    organisations,
    sessions,
    tenants,
    users,
)
from parfocal_common.db import CURRENT_TENANT, scoped_transaction

type Initials = Annotated[str, StringConstraints(pattern="^[A-Z]{1,3}$")]
type DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
type Title = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]


class Profile(BaseModel):
    user_id: uuid.UUID
    display_name: str
    initials: str
    avatar_colour: int
    title: str | None


class Workspace(BaseModel):
    tenant_id: uuid.UUID
    slug: str
    name: str
    kind: TenantKind
    status: TenantStatus
    organisation_name: str


class Me(Profile):
    email: str | None
    active_tenant_id: uuid.UUID | None
    workspaces: list[Workspace]


class ProfileChange(BaseModel):
    display_name: DisplayName | None = None
    initials: Initials | None = None
    avatar_colour: Annotated[int, Field(ge=0, lt=AVATAR_COLOURS)] | None = None
    title: Title | None = None


class WorkspaceChoice(BaseModel):
    tenant_id: uuid.UUID


class MembershipDraft(BaseModel):
    user_id: uuid.UUID


class Membership(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID


class NotAMemberError(ForbiddenError):
    code = "not-a-member"
    title = "You are not a member of this workspace"


class AlreadyAMemberError(ConflictError):
    code = "already-a-member"
    title = "This person is already a member of this workspace"


PROFILE_COLUMNS = (
    users.c.id.label("user_id"),
    users.c.display_name,
    users.c.initials,
    users.c.avatar_colour,
    users.c.title,
)


def profile_of(row: object) -> Profile:
    return Profile.model_validate(row, from_attributes=True)


def signed_in(principal: CurrentPrincipal) -> SignedInUser | MemberPrincipal:
    if not isinstance(principal, SignedInUser | MemberPrincipal):
        raise ForbiddenError
    return principal


async def own_workspaces(connection: AsyncConnection, user_id: uuid.UUID) -> list[Workspace]:
    rows = await connection.execute(
        select(
            tenants.c.id.label("tenant_id"),
            tenants.c.slug,
            tenants.c.name,
            tenants.c.kind,
            tenants.c.status,
            organisations.c.name.label("organisation_name"),
        )
        .join(memberships, memberships.c.tenant_id == tenants.c.id)
        .join(organisations, organisations.c.id == tenants.c.organisation_id)
        .where(memberships.c.user_id == user_id)
        .order_by(organisations.c.name, tenants.c.name)
    )
    return [Workspace.model_validate(row, from_attributes=True) for row in rows]


async def me_of(connection: AsyncConnection, principal: SignedInUser | MemberPrincipal) -> Me:
    row = (
        await connection.execute(
            select(*PROFILE_COLUMNS, users.c.email).where(users.c.id == principal.user_id)
        )
    ).one()
    active = principal.tenant_id if isinstance(principal, MemberPrincipal) else None
    return Me(
        **profile_of(row).model_dump(),
        email=row.email,
        active_tenant_id=active,
        workspaces=await own_workspaces(connection, principal.user_id),
    )


me_router = APIRouter(prefix="/api/me", tags=["me"])
tenant_router = APIRouter(prefix="/api/tenant", tags=["tenant"])
platform_router = APIRouter(prefix="/api/platform", tags=["platform"])


@me_router.get("", operation_id="getMe")
async def get_me(principal: CurrentPrincipal, connection: UserConnection) -> Me:
    return await me_of(connection, signed_in(principal))


@me_router.patch("", operation_id="updateMe")
async def update_me(
    change: ProfileChange, principal: CurrentPrincipal, connection: UserConnection
) -> Me:
    person = signed_in(principal)
    values = change.model_dump(exclude_unset=True)
    if "title" in values and not values["title"]:
        values["title"] = None
    if values:
        await connection.execute(update(users).where(users.c.id == person.user_id).values(values))
    return await me_of(connection, person)


@me_router.put("/workspace", operation_id="switchWorkspace")
async def switch_workspace(
    choice: WorkspaceChoice,
    request: Request,
    principal: CurrentPrincipal,
    connection: UserConnection,
) -> Workspace:
    person = signed_in(principal)
    chosen = next(
        (
            workspace
            for workspace in await own_workspaces(connection, person.user_id)
            if workspace.tenant_id == choice.tenant_id
        ),
        None,
    )
    if chosen is None:
        raise NotAMemberError
    if chosen.status is TenantStatus.SUSPENDED:
        raise TenantSuspendedError
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise UnauthenticatedError
    async with scoped_transaction(auth_state(request).engine, AUTH_SCOPE) as auth:
        await auth.execute(
            update(sessions)
            .where(sessions.c.id_hash == digest(session_id))
            .values(active_tenant_id=chosen.tenant_id)
        )
        await auth.execute(
            update(users)
            .where(users.c.id == person.user_id)
            .values(last_tenant_id=chosen.tenant_id)
        )
    return chosen


@tenant_router.get("/members", operation_id="listTenantMembers")
async def list_tenant_members(connection: TenantConnection) -> list[Profile]:
    rows = await connection.execute(
        select(*PROFILE_COLUMNS)
        .join(memberships, memberships.c.user_id == users.c.id)
        .where(memberships.c.tenant_id == literal_column(CURRENT_TENANT))
        .order_by(users.c.display_name)
    )
    return [profile_of(row) for row in rows]


@platform_router.post("/tenants/{tenant_id}/members", operation_id="addMember", status_code=201)
async def add_member(
    tenant_id: uuid.UUID, draft: MembershipDraft, connection: PlatformConnection
) -> Membership:
    for table, key, label in ((tenants, tenant_id, "Tenant"), (users, draft.user_id, "User")):
        if not await connection.scalar(select(exists().where(table.c.id == key))):
            raise NotFoundError(f"{label} not found")
    try:
        row = (
            await connection.execute(
                insert(memberships)
                .values(tenant_id=tenant_id, user_id=draft.user_id)
                .returning(memberships.c.id, memberships.c.tenant_id, memberships.c.user_id)
            )
        ).one()
    except IntegrityError as error:
        raise AlreadyAMemberError from error
    return Membership.model_validate(row, from_attributes=True)


@platform_router.get("/tenants/{tenant_id}/members", operation_id="listMembers")
async def list_members(tenant_id: uuid.UUID, connection: PlatformConnection) -> list[Profile]:
    rows = await connection.execute(
        select(*PROFILE_COLUMNS)
        .join(memberships, memberships.c.user_id == users.c.id)
        .where(memberships.c.tenant_id == tenant_id)
        .order_by(users.c.display_name)
    )
    return [profile_of(row) for row in rows]
