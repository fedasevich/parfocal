import uuid
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.opinion_questions import (
    DEFAULT_QUESTIONS,
    QUESTIONS,
    FormChange,
    Question,
    dumped,
    publish,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import NotFoundError
from parfocal_api.projects import ProjectArchivedError, owned, visible
from parfocal_api.tables import opinion_forms


class OpinionForm(BaseModel):
    project_id: uuid.UUID
    version: int
    questions: list[Question]
    created_at: datetime


class FormVersion(BaseModel):
    project_id: uuid.UUID
    version: int
    created_at: datetime


router = APIRouter(prefix="/api/projects", tags=["projects"])
template_router = APIRouter(prefix="/api/opinion-form-template", tags=["projects"])


async def form_of(
    connection: AsyncConnection, project_id: uuid.UUID, version: int | None = None
) -> OpinionForm:
    statement = select(opinion_forms).where(opinion_forms.c.project_id == project_id)
    if version is None:
        statement = statement.order_by(opinion_forms.c.version.desc()).limit(1)
    else:
        statement = statement.where(opinion_forms.c.version == version)
    row = (await connection.execute(statement)).one_or_none()
    if row is None:
        raise NotFoundError("Opinion form not found")
    return OpinionForm(
        project_id=row.project_id,
        version=row.version,
        questions=QUESTIONS.validate_python(row.questions),
        created_at=row.created_at,
    )


@template_router.get("", operation_id="getOpinionFormTemplate")
async def get_opinion_form_template(connection: TenantConnection) -> list[Question]:
    return DEFAULT_QUESTIONS


@router.get(
    "/{project_id}/opinion-form",
    operation_id="getOpinionForm",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_opinion_form(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> OpinionForm:
    await visible(connection, principal, project_id)
    return await form_of(connection, project_id)


@router.get(
    "/{project_id}/opinion-form/versions",
    operation_id="listOpinionFormVersions",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_opinion_form_versions(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[FormVersion]:
    await visible(connection, principal, project_id)
    rows = await connection.execute(
        select(opinion_forms.c.project_id, opinion_forms.c.version, opinion_forms.c.created_at)
        .where(opinion_forms.c.project_id == project_id)
        .order_by(opinion_forms.c.version)
    )
    return [FormVersion.model_validate(row, from_attributes=True) for row in rows]


@router.get(
    "/{project_id}/opinion-form/versions/{version}",
    operation_id="getOpinionFormVersion",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_opinion_form_version(
    project_id: uuid.UUID, version: int, principal: CurrentPrincipal, connection: TenantConnection
) -> OpinionForm:
    await visible(connection, principal, project_id)
    return await form_of(connection, project_id, version)


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    version: int,
    questions: int,
) -> None:
    await record(
        connection,
        actor_of(principal),
        AuditAction.PROJECT_OPINION_FORM_PUBLISHED,
        AuditTarget.PROJECT,
        project_id,
        tenant_id=tenant_id,
        details={"version": version, "questions": questions},
    )


@router.put(
    "/{project_id}/opinion-form",
    operation_id="publishOpinionForm",
    **require(Permission.CREATE_CASES, write=True),
)
async def publish_opinion_form(
    project_id: uuid.UUID,
    change: FormChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> OpinionForm:
    project = await owned(connection, principal, project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    latest = await connection.scalar(
        select(opinion_forms.c.version)
        .where(opinion_forms.c.project_id == project_id)
        .order_by(opinion_forms.c.version.desc())
        .limit(1)
    )
    if latest is not None:
        current = await form_of(connection, project_id, latest)
        if dumped(current.questions) == dumped(change.questions):
            return current
    user_id = principal.user_id if isinstance(principal, MemberPrincipal) else None
    version = await publish(connection, project.tenant_id, project_id, user_id, change.questions)
    await audit(
        connection, principal, project.tenant_id, project_id, version, len(change.questions)
    )
    return await form_of(connection, project_id, version)
