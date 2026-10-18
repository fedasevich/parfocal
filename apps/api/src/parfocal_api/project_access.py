import uuid

from sqlalchemy import ColumnElement, Select, exists, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.permissions import (
    PROJECT_MATRIX,
    Grant,
    Permission,
    grant_of,
    in_project,
    may_ask_for_emergency_access,
)
from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.tables import (
    PrivacyMode,
    ProjectRole,
    emergency_grants,
    project_members,
    review_assignments,
    review_tasks,
)

READERS = tuple(
    role
    for role, grant in PROJECT_MATRIX[Permission.SEE_SLIDES].items()
    if grant in {Grant.ALL, Grant.VIEW_ONLY}
)


class EmergencyAccessNeededError(ForbiddenError):
    code = "emergency-access-needed"
    title = "Give a reason to open this clinical project"


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


def open_grants(principal: MemberPrincipal) -> ColumnElement[bool]:
    return (emergency_grants.c.user_id == principal.user_id) & (
        emergency_grants.c.expires_at > func.now()
    )


async def emergency_open(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> bool:
    if not isinstance(principal, MemberPrincipal):
        return False
    return bool(
        await connection.scalar(
            select(
                exists().where(open_grants(principal), emergency_grants.c.project_id == project_id)
            )
        )
    )


async def holds_any_grant(connection: AsyncConnection, principal: Principal) -> bool:
    if not isinstance(principal, MemberPrincipal):
        return False
    return bool(await connection.scalar(select(exists().where(open_grants(principal)))))


async def project_grant(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    permission: Permission,
) -> Grant:
    workspace = grant_of(principal, permission)
    if isinstance(principal, ServicePrincipal):
        return workspace
    grant = in_project(workspace, permission, await role_in(connection, principal, project_id))
    if (
        grant is Grant.NONE
        and permission is Permission.SEE_SLIDES
        and may_ask_for_emergency_access(principal)
        and await emergency_open(connection, principal, project_id)
    ):
        return Grant.VIEW_ONLY
    return grant


def reads_whole(grant: Grant) -> bool:
    return grant in {Grant.ALL, Grant.VIEW_ONLY}


async def require_reading(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    privacy_mode: PrivacyMode,
    missing: str,
) -> None:
    if reads_whole(await project_grant(connection, principal, project_id, Permission.SEE_SLIDES)):
        return
    outside = await role_in(connection, principal, project_id) is None
    if outside and privacy_mode is PrivacyMode.CLINICAL and may_ask_for_emergency_access(principal):
        raise EmergencyAccessNeededError
    raise NotFoundError(missing)


def readable(principal: Principal, project_column: ColumnElement[uuid.UUID]) -> ColumnElement[bool]:
    if isinstance(principal, ServicePrincipal):
        return true()
    assert isinstance(principal, MemberPrincipal)
    return or_(
        project_column.in_(
            select(project_members.c.project_id).where(
                project_members.c.user_id == principal.user_id,
                project_members.c.role.in_(READERS),
            )
        ),
        project_column.in_(select(emergency_grants.c.project_id).where(open_grants(principal))),
    )


def assigned_slides(principal: Principal) -> Select[tuple[uuid.UUID]]:
    user_id = principal.user_id if isinstance(principal, MemberPrincipal) else None
    return (
        select(review_assignments.c.slide_id)
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(review_assignments.c.user_id == user_id, review_tasks.c.archived_at.is_(None))
    )


async def reads_slide(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> bool:
    grant = await project_grant(connection, principal, project_id, Permission.SEE_SLIDES)
    if reads_whole(grant):
        return True
    if grant is not Grant.ASSIGNED or not isinstance(principal, MemberPrincipal):
        return False
    mine = assigned_slides(principal).where(review_assignments.c.slide_id == slide_id)
    return bool(await connection.scalar(select(mine.exists())))


async def require_slide_reading(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    privacy_mode: PrivacyMode,
    slide_id: uuid.UUID,
    missing: str,
) -> None:
    if await reads_slide(connection, principal, project_id, slide_id):
        return
    await require_reading(connection, principal, project_id, privacy_mode, missing)


async def reviews_slide(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> Grant:
    grant = await project_grant(connection, principal, project_id, Permission.REVIEW)
    if grant is Grant.ASSIGNED and not await reads_slide(
        connection, principal, project_id, slide_id
    ):
        return Grant.NONE
    return grant


def readable_slide(
    principal: Principal,
    project_column: ColumnElement[uuid.UUID],
    slide_column: ColumnElement[uuid.UUID],
) -> ColumnElement[bool]:
    if isinstance(principal, ServicePrincipal):
        return true()
    return or_(readable(principal, project_column), slide_column.in_(assigned_slides(principal)))
