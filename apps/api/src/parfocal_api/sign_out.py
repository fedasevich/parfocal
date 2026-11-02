import uuid
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import (
    SIGN_OUT_DEFAULTS,
    SIGN_OUT_FIXED,
    Permission,
    covers_case,
    require,
    sign_out_right,
)
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.project_access import assigned_slides
from parfocal_api.projects import (
    Project,
    ProjectArchivedError,
    current_role,
    owned,
    project_of,
    workspace_member,
)
from parfocal_api.tables import (
    PrivacyMode,
    ProjectRole,
    SignOutRight,
    cases,
    project_members,
    projects,
    review_assignments,
    slides,
)


class SignOutChange(BaseModel):
    sign_out: SignOutRight


class SignOutWarning(StrEnum):
    NO_ONE_SIGNS_OUT = "no-one-signs-out"


class SignOutSet(BaseModel):
    project: Project
    warning: SignOutWarning | None


class NoSignOutRightError(ConflictError):
    code = "no-sign-out-right"
    title = "A de-identified project has no clinical report and no Can sign out right"


class ViewersNeverSignOutError(BadRequestError):
    code = "viewers-never-sign-out"
    title = "A project viewer never signs out"


SIGNERS = [role for role in SIGN_OUT_DEFAULTS if role not in SIGN_OUT_FIXED]
DEFAULT_SIGNERS = [role for role in SIGNERS if SIGN_OUT_DEFAULTS[role] is not SignOutRight.NEVER]

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def others_who_sign_out(
    connection: AsyncConnection, project_id: uuid.UUID, user_id: uuid.UUID
) -> int:
    stored = project_members.c.sign_out
    count = await connection.scalar(
        select(func.count()).where(
            project_members.c.project_id == project_id,
            project_members.c.user_id != user_id,
            project_members.c.role.in_(SIGNERS),
            or_(
                stored.in_([SignOutRight.OWN_CASES, SignOutRight.ANY_CASE]),
                stored.is_(None) & project_members.c.role.in_(DEFAULT_SIGNERS),
            ),
        )
    )
    return int(count or 0)


@router.put(
    "/{project_id}/members/{user_id}/sign-out",
    operation_id="setProjectMemberSignOut",
    **require(Permission.CREATE_CASES, write=True),
)
async def set_project_member_sign_out(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    change: SignOutChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SignOutSet:
    row = await owned(connection, principal, project_id)
    if row.archived_at is not None:
        raise ProjectArchivedError
    privacy_mode = PrivacyMode(row.privacy_mode)
    if privacy_mode is not PrivacyMode.CLINICAL:
        raise NoSignOutRightError
    role = await current_role(connection, project_id, user_id)
    if role is None:
        raise NotFoundError("Project member not found")
    if role in SIGN_OUT_FIXED and change.sign_out is not SIGN_OUT_DEFAULTS[role]:
        raise ViewersNeverSignOutError
    stored = await connection.scalar(
        select(project_members.c.sign_out).where(
            project_members.c.project_id == project_id, project_members.c.user_id == user_id
        )
    )
    before = sign_out_right(privacy_mode, role, stored)
    if before is not change.sign_out:
        await connection.execute(
            update(project_members)
            .where(project_members.c.project_id == project_id, project_members.c.user_id == user_id)
            .values(sign_out=change.sign_out)
        )
        member = await workspace_member(connection, user_id)
        await record(
            connection,
            actor_of(principal),
            AuditAction.PROJECT_SIGN_OUT_SET,
            AuditTarget.PERSON,
            person=member.subject,
            tenant_id=row.tenant_id,
            details={"project_id": str(project_id), "from": before, "to": change.sign_out},
        )
    alone = change.sign_out is SignOutRight.NEVER
    warning = (
        SignOutWarning.NO_ONE_SIGNS_OUT
        if alone and await others_who_sign_out(connection, project_id, user_id) == 0
        else None
    )
    return SignOutSet(project=await project_of(connection, principal, project_id), warning=warning)


async def case_row(
    connection: AsyncConnection, principal: MemberPrincipal, case_id: uuid.UUID
) -> Any:
    return (
        await connection.execute(
            select(
                projects.c.id,
                projects.c.privacy_mode,
                project_members.c.role,
                project_members.c.sign_out,
            )
            .select_from(cases)
            .join(projects, projects.c.id == cases.c.project_id)
            .outerjoin(
                project_members,
                (project_members.c.project_id == projects.c.id)
                & (project_members.c.user_id == principal.user_id),
            )
            .where(cases.c.id == case_id)
        )
    ).one_or_none()


async def signs_out_case(
    connection: AsyncConnection, principal: Principal, case_id: uuid.UUID
) -> bool:
    if not isinstance(principal, MemberPrincipal):
        return False
    row = await case_row(connection, principal, case_id)
    if row is None:
        return False
    role = ProjectRole(row.role) if row.role else None
    right = sign_out_right(PrivacyMode(row.privacy_mode), role, row.sign_out)
    if right is not SignOutRight.OWN_CASES:
        return covers_case(right, assigned=False)
    own = (
        assigned_slides(principal)
        .join(slides, slides.c.id == review_assignments.c.slide_id)
        .where(slides.c.case_id == case_id)
    )
    return covers_case(right, assigned=bool(await connection.scalar(select(own.exists()))))
