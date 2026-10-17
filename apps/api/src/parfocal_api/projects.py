import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, insert, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.class_templates import TaxonomyTemplate, insert_template
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import emergency_open, require_reading, role_in
from parfocal_api.tables import (
    AnalysisTemplate,
    PrivacyMode,
    ProjectRole,
    Role,
    memberships,
    project_members,
    projects,
    users,
)
from parfocal_common.db import CURRENT_TENANT

type ProjectName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
type Colour = Annotated[int, Field(ge=0, le=11)]


class ProjectDraft(BaseModel):
    name: ProjectName
    colour: Colour = 0
    privacy_mode: PrivacyMode = PrivacyMode.DE_IDENTIFIED
    template: AnalysisTemplate = AnalysisTemplate.NONE
    taxonomy: TaxonomyTemplate | None = None


class ProjectChange(BaseModel):
    name: ProjectName | None = None
    colour: Colour | None = None
    template: AnalysisTemplate | None = None


class ProjectMember(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole


class MemberChange(BaseModel):
    role: ProjectRole


class Project(BaseModel):
    id: uuid.UUID
    code: str
    number: int
    name: str
    colour: int
    privacy_mode: PrivacyMode
    template: AnalysisTemplate
    archived_at: datetime | None
    created_at: datetime
    my_role: ProjectRole | None
    members: list[ProjectMember]


class OnlyMembersCreateProjectsError(ForbiddenError):
    code = "members-only"
    title = "Only members of this workspace create projects"


class OwnersOnlyError(ForbiddenError):
    code = "project-owners-only"
    title = "Only an owner of this project changes it"


class ProjectArchivedError(ConflictError):
    code = "project-archived"
    title = "This project is archived. Restore it first"


class LastOwnerError(ConflictError):
    code = "last-owner"
    title = "A project keeps at least one owner"


class NotAWorkspaceMemberError(BadRequestError):
    code = "not-a-member"
    title = "Only members of this workspace join its projects"


class ReviewersCannotOwnError(BadRequestError):
    code = "reviewers-cannot-own"
    title = "A workspace reviewer joins a project as a reviewer or a viewer"


IN_THIS_TENANT = projects.c.tenant_id == literal_column(CURRENT_TENANT)
LIVE = projects.c.deleted_at.is_(None)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def code_of(number: int) -> str:
    return f"P{number:02d}"


async def row_of(connection: AsyncConnection, project_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(projects).where(projects.c.id == project_id, IN_THIS_TENANT, LIVE)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Project not found")
    return row


async def visible(connection: AsyncConnection, principal: Principal, project_id: uuid.UUID) -> Any:
    row = await row_of(connection, project_id)
    if not isinstance(principal, MemberPrincipal):
        return row
    if await role_in(connection, principal, project_id) is not None:
        return row
    await require_reading(
        connection, principal, project_id, PrivacyMode(row.privacy_mode), "Project not found"
    )
    return row


async def owned(connection: AsyncConnection, principal: Principal, project_id: uuid.UUID) -> Any:
    row = await row_of(connection, project_id)
    role = await role_in(connection, principal, project_id)
    if role is ProjectRole.OWNER:
        return row
    if role is None and not await emergency_open(connection, principal, project_id):
        raise NotFoundError("Project not found")
    raise OwnersOnlyError


async def project_of(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> Project:
    row = await row_of(connection, project_id)
    members = await connection.execute(
        select(project_members.c.user_id, project_members.c.role)
        .where(project_members.c.project_id == project_id)
        .order_by(project_members.c.role, project_members.c.user_id)
    )
    return Project(
        id=row.id,
        code=code_of(row.number),
        number=row.number,
        name=row.name,
        colour=row.colour,
        privacy_mode=PrivacyMode(row.privacy_mode),
        template=AnalysisTemplate(row.template),
        archived_at=row.archived_at,
        created_at=row.created_at,
        my_role=await role_in(connection, principal, project_id),
        members=[ProjectMember(user_id=m.user_id, role=ProjectRole(m.role)) for m in members],
    )


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    project_id: uuid.UUID,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.PROJECT,
        project_id,
        tenant_id=database_scope(principal).tenant_id,
        details=details,
    )


async def owners_left(connection: AsyncConnection, project_id: uuid.UUID) -> int:
    count = await connection.scalar(
        select(func.count()).where(
            project_members.c.project_id == project_id,
            project_members.c.role == ProjectRole.OWNER,
        )
    )
    return int(count or 0)


@router.post(
    "",
    operation_id="createProject",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def create_project(
    draft: ProjectDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> Project:
    if not isinstance(principal, MemberPrincipal):
        raise OnlyMembersCreateProjectsError
    await connection.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"project-number:{principal.tenant_id}", 0)
            )
        )
    )
    number = select(func.coalesce(func.max(projects.c.number), 0) + 1).where(IN_THIS_TENANT)
    row = (
        await connection.execute(
            insert(projects)
            .values(
                tenant_id=principal.tenant_id,
                number=number.scalar_subquery(),
                created_by_user_id=principal.user_id,
                **draft.model_dump(exclude={"taxonomy"}),
            )
            .returning(projects.c.id, projects.c.number)
        )
    ).one()
    await connection.execute(
        insert(project_members).values(
            tenant_id=principal.tenant_id,
            project_id=row.id,
            user_id=principal.user_id,
            role=ProjectRole.OWNER,
        )
    )
    if draft.taxonomy is not None:
        await insert_template(connection, principal.tenant_id, row.id, draft.taxonomy)
    await audit(
        connection,
        principal,
        AuditAction.PROJECT_CREATED,
        row.id,
        {
            "number": row.number,
            "privacy_mode": draft.privacy_mode,
            "template": draft.template,
            "taxonomy": draft.taxonomy,
        },
    )
    return await project_of(connection, principal, row.id)


@router.get("", operation_id="listProjects", **require(Permission.SEE_SLIDES))
async def list_projects(
    principal: CurrentPrincipal, connection: TenantConnection, archived: bool = False
) -> list[Project]:
    statement = select(projects.c.id).where(
        IN_THIS_TENANT,
        LIVE,
        projects.c.archived_at.is_not(None) if archived else projects.c.archived_at.is_(None),
    )
    if isinstance(principal, MemberPrincipal):
        statement = statement.join(
            project_members,
            (project_members.c.project_id == projects.c.id)
            & (project_members.c.user_id == principal.user_id),
        )
    ids = await connection.scalars(statement.order_by(projects.c.number))
    return [await project_of(connection, principal, project_id) for project_id in ids]


@router.get(
    "/{project_id}", operation_id="getProject", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_project(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Project:
    await visible(connection, principal, project_id)
    return await project_of(connection, principal, project_id)


@router.patch(
    "/{project_id}",
    operation_id="updateProject",
    **require(Permission.CREATE_CASES, write=True),
)
async def update_project(
    project_id: uuid.UUID,
    change: ProjectChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Project:
    row = await owned(connection, principal, project_id)
    if row.archived_at is not None:
        raise ProjectArchivedError
    values = {
        field: value
        for field, value in change.model_dump(exclude_none=True).items()
        if getattr(row, field) != value
    }
    if values:
        await connection.execute(
            update(projects).where(projects.c.id == project_id).values(**values)
        )
        await audit(
            connection,
            principal,
            AuditAction.PROJECT_CHANGED,
            project_id,
            {"fields": sorted(values)},
        )
    return await project_of(connection, principal, project_id)


async def set_archived(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, archive: bool
) -> Project:
    row = await owned(connection, principal, project_id)
    if (row.archived_at is not None) != archive:
        await connection.execute(
            update(projects)
            .where(projects.c.id == project_id)
            .values(archived_at=func.now() if archive else None)
        )
        action = AuditAction.PROJECT_ARCHIVED if archive else AuditAction.PROJECT_RESTORED
        await audit(connection, principal, action, project_id, {})
    return await project_of(connection, principal, project_id)


@router.post(
    "/{project_id}/archive",
    operation_id="archiveProject",
    **require(Permission.CREATE_CASES, write=True),
)
async def archive_project(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Project:
    return await set_archived(connection, principal, project_id, archive=True)


@router.post(
    "/{project_id}/restore",
    operation_id="restoreProject",
    **require(Permission.CREATE_CASES, write=True),
)
async def restore_project(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Project:
    return await set_archived(connection, principal, project_id, archive=False)


async def workspace_member(connection: AsyncConnection, user_id: uuid.UUID) -> Any:
    member = (
        await connection.execute(
            select(memberships.c.role, users.c.subject)
            .join(users, users.c.id == memberships.c.user_id)
            .where(
                memberships.c.user_id == user_id,
                memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            )
        )
    ).one_or_none()
    if member is None:
        raise NotAWorkspaceMemberError
    return member


async def current_role(
    connection: AsyncConnection, project_id: uuid.UUID, user_id: uuid.UUID
) -> ProjectRole | None:
    role = await connection.scalar(
        select(project_members.c.role)
        .where(project_members.c.project_id == project_id, project_members.c.user_id == user_id)
        .with_for_update()
    )
    return ProjectRole(role) if role else None


@router.put(
    "/{project_id}/members/{user_id}",
    operation_id="setProjectMember",
    **require(Permission.CREATE_CASES, write=True),
)
async def set_project_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    change: MemberChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Project:
    row = await owned(connection, principal, project_id)
    if row.archived_at is not None:
        raise ProjectArchivedError
    member = await workspace_member(connection, user_id)
    if change.role is ProjectRole.OWNER and member.role == Role.REVIEWER:
        raise ReviewersCannotOwnError
    before = await current_role(connection, project_id, user_id)
    demoted = before is ProjectRole.OWNER and change.role is not ProjectRole.OWNER
    if demoted and await owners_left(connection, project_id) == 1:
        raise LastOwnerError
    if before is not change.role:
        await connection.execute(
            upsert(project_members)
            .values(
                tenant_id=row.tenant_id, project_id=project_id, user_id=user_id, role=change.role
            )
            .on_conflict_do_update(
                index_elements=[project_members.c.project_id, project_members.c.user_id],
                set_={"role": change.role},
            )
        )
        await record(
            connection,
            actor_of(principal),
            AuditAction.PROJECT_MEMBER_SET,
            AuditTarget.PERSON,
            person=member.subject,
            tenant_id=row.tenant_id,
            details={"project_id": str(project_id), "from": before, "to": change.role},
        )
    return await project_of(connection, principal, project_id)


@router.delete(
    "/{project_id}/members/{user_id}",
    operation_id="removeProjectMember",
    status_code=204,
    response_class=Response,
    **require(Permission.CREATE_CASES, write=True),
)
async def remove_project_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> None:
    row = await owned(connection, principal, project_id)
    if row.archived_at is not None:
        raise ProjectArchivedError
    before = await current_role(connection, project_id, user_id)
    if before is None:
        raise NotFoundError("Project member not found")
    if before is ProjectRole.OWNER and await owners_left(connection, project_id) == 1:
        raise LastOwnerError
    member = await workspace_member(connection, user_id)
    await connection.execute(
        delete(project_members).where(
            project_members.c.project_id == project_id, project_members.c.user_id == user_id
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.PROJECT_MEMBER_REMOVED,
        AuditTarget.PERSON,
        person=member.subject,
        tenant_id=row.tenant_id,
        details={"project_id": str(project_id), "from": before},
    )
