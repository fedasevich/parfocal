import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import insert, update

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import AUTH_SCOPE, SESSION_COOKIE, digest
from parfocal_api.context import CurrentPrincipal, engine_of
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
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
from parfocal_api.users import Workspace, signed_in
from parfocal_common.db import DatabaseScope, scoped_transaction

router = APIRouter(prefix="/api/me", tags=["me"])

type WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


class WorkspaceDraft(BaseModel):
    name: WorkspaceName
    default_privacy_mode: Literal["de-identified", "clinical"] = "de-identified"


def slug_of(name: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", name.lower())[:24].strip("-") or "workspace"
    return f"{stem}-{uuid.uuid4().hex[:8]}"


@router.post("/workspaces", operation_id="createMyWorkspace", status_code=201)
async def create_my_workspace(
    draft: WorkspaceDraft, request: Request, principal: CurrentPrincipal
) -> Workspace:
    person = signed_in(principal)
    slug = slug_of(draft.name)
    engine = engine_of(request)
    async with scoped_transaction(engine, DatabaseScope(platform=True)) as connection:
        organisation_id = (
            await connection.execute(
                insert(organisations)
                .values(slug=slug, name=draft.name)
                .returning(organisations.c.id)
            )
        ).scalar_one()
        tenant_id = (
            await connection.execute(
                insert(tenants)
                .values(
                    organisation_id=organisation_id,
                    slug=slug,
                    name=draft.name,
                    kind=TenantKind.RESEARCH,
                    region=Region.EU,
                    plan=Plan.PILOT,
                )
                .returning(tenants.c.id)
            )
        ).scalar_one()
        await seed_built_ins(connection, tenant_id)
        await connection.execute(
            insert(memberships).values(
                tenant_id=tenant_id,
                user_id=person.user_id,
                role=Role.RESEARCHER,
                admin_rights=True,
            )
        )
        actor = actor_of(principal)
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
        )
    async with scoped_transaction(
        engine, DatabaseScope(tenant_id=tenant_id, user_id=person.user_id)
    ) as inside:
        await inside.execute(
            insert(workspace_settings).values(
                tenant_id=tenant_id, values={"default_privacy_mode": draft.default_privacy_mode}
            )
        )
    session_id = request.cookies.get(SESSION_COOKIE)
    async with scoped_transaction(engine, AUTH_SCOPE) as auth:
        if session_id:
            await auth.execute(
                update(sessions)
                .where(sessions.c.id_hash == digest(session_id))
                .values(active_tenant_id=tenant_id)
            )
        await auth.execute(
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
    )
