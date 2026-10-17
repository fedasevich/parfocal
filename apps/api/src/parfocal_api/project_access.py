import uuid

from sqlalchemy import ColumnElement, select, true
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.permissions import (
    PROJECT_MATRIX,
    Grant,
    Permission,
    grant_of,
    in_project,
)
from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.tables import ProjectRole, project_members

READERS = tuple(
    role
    for role, grant in PROJECT_MATRIX[Permission.SEE_SLIDES].items()
    if grant in {Grant.ALL, Grant.VIEW_ONLY}
)


async def role_in(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> ProjectRole | None:
    if not isinstance(principal, MemberPrincipal):
        return None
    role = await connection.scalar(
        select(project_members.c.role).where(
            project_members.c.project_id == project_id,
            project_members.c.user_id == principal.user_id,
        )
    )
    return ProjectRole(role) if role else None


async def project_grant(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    permission: Permission,
) -> Grant:
    workspace = grant_of(principal, permission)
    if isinstance(principal, ServicePrincipal):
        return workspace
    return in_project(workspace, permission, await role_in(connection, principal, project_id))


def reads_whole(grant: Grant) -> bool:
    return grant in {Grant.ALL, Grant.VIEW_ONLY}


def readable(principal: Principal, project_column: ColumnElement[uuid.UUID]) -> ColumnElement[bool]:
    if isinstance(principal, ServicePrincipal):
        return true()
    assert isinstance(principal, MemberPrincipal)
    return project_column.in_(
        select(project_members.c.project_id).where(
            project_members.c.user_id == principal.user_id,
            project_members.c.role.in_(READERS),
        )
    )
