import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import exists, insert, select, update

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import SESSION_COOKIE, digest
from parfocal_api.context import CurrentPrincipal, engine_of
from parfocal_api.problems import ConflictError, UnauthenticatedError
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
    LOGO_COLOUR_PATTERN,
    LOGO_PATTERN,
    Plan,
    Region,
    Role,
    TenantKind,
    TenantStatus,
    memberships,
    organisations,
    sessions,
    tenants,
    users,
    workspace_settings,
)
from parfocal_api.users import Workspace, logo_colour_of, logo_mark_of, signed_in
from parfocal_common.db import DatabaseScope, scoped_transaction


class AlreadyAnAdminError(ConflictError):
    code = "already-an-admin"
    title = "You already have admin rights on a workspace"


router = APIRouter(prefix="/api/me", tags=["me"])

type WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


type LogoMark = Annotated[str, StringConstraints(strip_whitespace=True, pattern=LOGO_PATTERN)]
type LogoColour = Annotated[str, StringConstraints(pattern=LOGO_COLOUR_PATTERN)]


class WorkspaceDraft(BaseModel):
    name: WorkspaceName
    default_privacy_mode: Literal["de-identified", "clinical"] = "de-identified"
    logo: LogoMark | None = None
    logo_colour: LogoColour | None = None


def slug_of(name: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", name.lower())[:24].strip("-") or "workspace"
    return f"{stem}-{uuid.uuid4().hex[:8]}"


@router.post("/workspaces", operation_id="createMyWorkspace", status_code=201)
async def create_my_workspace(
    draft: WorkspaceDraft, request: Request, principal: CurrentPrincipal
) -> Workspace:
    person = signed_in(principal)
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise UnauthenticatedError
    slug = slug_of(draft.name)
    tenant_id = uuid.uuid4()
    scope = DatabaseScope(tenant_id=tenant_id, user_id=person.user_id, platform=True, auth=True)
    async with scoped_transaction(engine_of(request), scope) as connection:
        holds_admin_rights = await connection.scalar(
            select(
                exists().where(
                    memberships.c.user_id == person.user_id, memberships.c.admin_rights.is_(True)
                )
            )
        )
        if holds_admin_rights:
            raise AlreadyAnAdminError
        logo = draft.logo or logo_mark_of(draft.name)
        logo_colour = draft.logo_colour or logo_colour_of(tenant_id)
        organisation_id = (
            await connection.execute(
                insert(organisations)
                .values(slug=slug, name=draft.name)
                .returning(organisations.c.id)
            )
        ).scalar_one()
        await connection.execute(
            insert(tenants).values(
                id=tenant_id,
                organisation_id=organisation_id,
                slug=slug,
                name=draft.name,
                kind=TenantKind.RESEARCH,
                region=Region.EU,
                plan=Plan.PILOT,
                logo=logo,
                logo_colour=logo_colour,
            )
        )
        await seed_built_ins(connection, tenant_id)
        await connection.execute(
            insert(memberships).values(
                tenant_id=tenant_id,
                user_id=person.user_id,
                role=Role.RESEARCHER,
                admin_rights=True,
            )
        )
        await connection.execute(
            insert(workspace_settings).values(
                tenant_id=tenant_id, values={"default_privacy_mode": draft.default_privacy_mode}
            )
        )
        actor = actor_of(principal)
        await record(
            connection,
            actor,
            AuditAction.ORGANISATION_CREATED,
            AuditTarget.ORGANISATION,
            organisation_id,
        )
        await record(
            connection,
            actor,
            AuditAction.TENANT_CREATED,
            AuditTarget.TENANT,
            tenant_id,
            tenant_id=tenant_id,
        )
        await record(
            connection,
            actor,
            AuditAction.MEMBER_ADDED,
            AuditTarget.PERSON,
            person=person.subject,
            tenant_id=tenant_id,
            details={"role": Role.RESEARCHER.value, "admin_rights": True},
        )
        await connection.execute(
            update(sessions)
            .where(sessions.c.id_hash == digest(session_id))
            .values(active_tenant_id=tenant_id)
        )
        await connection.execute(
            update(users).where(users.c.id == person.user_id).values(last_tenant_id=tenant_id)
        )
    return Workspace(
        tenant_id=tenant_id,
        role=Role.RESEARCHER,
        admin_rights=True,
        slug=slug,
        name=draft.name,
        kind=TenantKind.RESEARCH,
        status=TenantStatus.ACTIVE,
        organisation_name=draft.name,
        logo=logo,
        logo_colour=logo_colour,
    )
