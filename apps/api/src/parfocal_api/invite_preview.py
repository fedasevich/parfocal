import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction
from parfocal_api.auth import AUTH_SCOPE, auth_state, digest
from parfocal_api.invitations import EXPIRED, InvitationNotFoundError
from parfocal_api.projects import code_of as project_code
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.tables import (
    PrivacyMode,
    audit_events,
    audit_people,
    invitations,
    projects,
    review_task_slides,
    review_tasks,
    study_template_versions,
    tenants,
    users,
)
from parfocal_common.db import DatabaseScope, scoped_transaction


class InvitedBy(BaseModel):
    user_id: uuid.UUID
    display_name: str
    initials: str
    avatar_colour: int = Field(ge=0)
    title: str | None


class InviteWorkspace(BaseModel):
    id: uuid.UUID
    name: str


class InviteProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    colour: int = Field(ge=0)
    privacy_mode: PrivacyMode
    study_template: str


class InviteTask(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    slides: int = Field(ge=0)
    hours: float | None = Field(ge=0)
    scope: str
    due_on: date | None
    blinded: bool
    first_slide_id: uuid.UUID


class InvitePreview(BaseModel):
    token: str
    email: str
    name: str
    invited_by: InvitedBy | None
    sent_at: datetime
    workspace: InviteWorkspace
    project: InviteProject
    task: InviteTask
    specialty: str | None
    expires_on: date


router = APIRouter(prefix="/api/invitations", tags=["invitations"])


async def inviter_of(connection: AsyncConnection, invitation_id: uuid.UUID) -> InvitedBy | None:
    row = (
        await connection.execute(
            select(
                users.c.id,
                users.c.display_name,
                users.c.initials,
                users.c.avatar_colour,
                users.c.title,
            )
            .join(audit_people, audit_people.c.subject == users.c.subject)
            .join(audit_events, audit_events.c.actor_id == audit_people.c.id)
            .where(
                audit_events.c.action == AuditAction.INVITATION_CREATED,
                audit_events.c.target_id == invitation_id,
            )
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        return None
    return InvitedBy(
        user_id=row.id,
        display_name=row.display_name,
        initials=row.initials,
        avatar_colour=max(0, row.avatar_colour),
        title=row.title,
    )


async def task_of(connection: AsyncConnection, task_id: uuid.UUID) -> Any:
    slide_count = (
        select(func.count())
        .where(review_task_slides.c.task_id == review_tasks.c.id)
        .scalar_subquery()
    )
    first_slide = (
        select(review_task_slides.c.slide_id)
        .where(review_task_slides.c.task_id == review_tasks.c.id)
        .order_by(review_task_slides.c.position)
        .limit(1)
        .scalar_subquery()
    )
    return (
        await connection.execute(
            select(
                review_tasks.c.id,
                review_tasks.c.number,
                review_tasks.c.name,
                review_tasks.c.scope,
                review_tasks.c.due_on,
                review_tasks.c.blinded,
                slide_count.label("slides"),
                first_slide.label("first_slide_id"),
                projects.c.id.label("project_id"),
                projects.c.number.label("project_number"),
                projects.c.name.label("project_name"),
                projects.c.colour,
                projects.c.privacy_mode,
                study_template_versions.c.name.label("study_template"),
            )
            .join(projects, projects.c.id == review_tasks.c.project_id)
            .outerjoin(
                study_template_versions,
                (study_template_versions.c.template_id == review_tasks.c.study_template_id)
                & (study_template_versions.c.version == review_tasks.c.study_template_version),
            )
            .where(review_tasks.c.id == task_id, projects.c.deleted_at.is_(None))
        )
    ).one_or_none()


def scope_text(scope: str) -> str:
    return scope.replace("-", " ").capitalize()


@router.get("/{token}/preview", operation_id="getInvitePreview")
async def get_invite_preview(token: str, request: Request) -> InvitePreview:
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        tenant_id = await connection.scalar(
            select(invitations.c.tenant_id).where(invitations.c.token_hash == digest(token))
        )
    if tenant_id is None:
        raise InvitationNotFoundError
    async with scoped_transaction(
        state.engine, DatabaseScope(tenant_id=tenant_id, auth=True)
    ) as connection:
        invitation = (
            await connection.execute(
                select(*invitations.c, EXPIRED).where(invitations.c.token_hash == digest(token))
            )
        ).one()
        if (
            invitation.revoked_at is not None
            or invitation.accepted_at is not None
            or invitation.expired
            or invitation.task_id is None
        ):
            raise InvitationNotFoundError
        task = await task_of(connection, invitation.task_id)
        if task is None or task.first_slide_id is None:
            raise InvitationNotFoundError
        workspace = await connection.scalar(select(tenants.c.name).where(tenants.c.id == tenant_id))
        known = await connection.scalar(
            select(users.c.display_name).where(func.lower(users.c.email) == invitation.email)
        )
        return InvitePreview(
            token=token,
            email=invitation.email,
            name=known or "",
            invited_by=await inviter_of(connection, invitation.id),
            sent_at=invitation.created_at,
            workspace=InviteWorkspace(id=tenant_id, name=str(workspace)),
            project=InviteProject(
                id=task.project_id,
                code=project_code(task.project_number),
                name=task.project_name,
                colour=max(0, task.colour),
                privacy_mode=PrivacyMode(task.privacy_mode),
                study_template=task.study_template or "",
            ),
            task=InviteTask(
                id=task.id,
                code=task_code(task.number),
                name=task.name,
                slides=task.slides,
                hours=None,
                scope=scope_text(task.scope),
                due_on=task.due_on,
                blinded=task.blinded,
                first_slide_id=task.first_slide_id,
            ),
            specialty=None,
            expires_on=invitation.expires_at.date(),
        )
