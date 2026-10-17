from enum import StrEnum
from typing import Any

from fastapi import Depends

from parfocal_api.context import CurrentPrincipal
from parfocal_api.principals import MemberPrincipal, ServicePrincipal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import ProjectRole, Role

ROLE_NAMES = {
    Role.RESEARCHER: "Researcher",
    Role.REVIEWER: "Reviewer",
    Role.ADMIN: "Admin",
}

PROJECT_ROLE_NAMES = {
    ProjectRole.OWNER: "Owner, manages the project, its people and its tasks",
    ProjectRole.REVIEWER: "Reviewer, sees only the slides of their tasks",
    ProjectRole.VIEWER: "Viewer, reads the project",
}


class Grant(StrEnum):
    ALL = "y"
    ASSIGNED = "o"
    VIEW_ONLY = "r"
    EMERGENCY = "b"
    NONE = "n"


GRANT_NAMES = {
    Grant.ALL: "Yes",
    Grant.ASSIGNED: "In their tasks",
    Grant.VIEW_ONLY: "View only",
    Grant.EMERGENCY: "Emergency, with reason",
    Grant.NONE: "No",
}


class Permission(StrEnum):
    SEE_SLIDES = "see-slides"
    EMERGENCY_ACCESS = "emergency-access"
    CREATE_CASES = "create-cases"
    UPLOAD_SLIDES = "upload-slides"
    MOVE_SLIDES = "move-slides"
    REVIEW = "review"
    SET_OWN_STATUS = "set-own-status"
    SEE_PEOPLE = "see-people"
    MANAGE_PEOPLE = "manage-people"
    WORKSPACE_SETTINGS = "workspace-settings"
    INTEGRATIONS = "integrations"
    AUDIT_LOG = "audit-log"
    DEVELOPER_MODE = "developer-mode"


PERMISSION_NAMES = {
    Permission.SEE_SLIDES: "See projects, cases and slides",
    Permission.EMERGENCY_ACCESS: "Open a clinical project they are not in",
    Permission.CREATE_CASES: "Create projects and cases, edit their details",
    Permission.UPLOAD_SLIDES: "Upload slides and AI results, fix unmatched files",
    Permission.MOVE_SLIDES: "Move a slide between cases",
    Permission.REVIEW: "Give verdicts, fix results, comment",
    Permission.SET_OWN_STATUS: "Set their own status",
    Permission.SEE_PEOPLE: "See the workspace's people and their status",
    Permission.MANAGE_PEOPLE: "Invite people, change roles",
    Permission.WORKSPACE_SETTINGS: "Workspace settings and session security",
    Permission.INTEGRATIONS: "Storage, sources, API and webhooks",
    Permission.AUDIT_LOG: "Audit log",
    Permission.DEVELOPER_MODE: "Developer mode and API tokens",
}

COLUMNS = (Role.RESEARCHER, Role.REVIEWER, Role.ADMIN)

ROWS = {
    Permission.SEE_SLIDES: "yon",
    Permission.EMERGENCY_ACCESS: "bnb",
    Permission.CREATE_CASES: "ynn",
    Permission.UPLOAD_SLIDES: "ynn",
    Permission.MOVE_SLIDES: "ynn",
    Permission.REVIEW: "yon",
    Permission.SET_OWN_STATUS: "yyy",
    Permission.SEE_PEOPLE: "yry",
    Permission.MANAGE_PEOPLE: "nny",
    Permission.WORKSPACE_SETTINGS: "rny",
    Permission.INTEGRATIONS: "rny",
    Permission.AUDIT_LOG: "nny",
    Permission.DEVELOPER_MODE: "yny",
}

PROJECT_COLUMNS = (ProjectRole.OWNER, ProjectRole.REVIEWER, ProjectRole.VIEWER)

PROJECT_ROWS = {
    Permission.SEE_SLIDES: "yoy",
    Permission.CREATE_CASES: "ynn",
    Permission.UPLOAD_SLIDES: "ynn",
    Permission.MOVE_SLIDES: "ynn",
    Permission.REVIEW: "yon",
}

PROJECT_MATRIX: dict[Permission, dict[ProjectRole, Grant]] = {
    permission: {role: Grant(code) for role, code in zip(PROJECT_COLUMNS, codes, strict=True)}
    for permission, codes in PROJECT_ROWS.items()
}

NARROWING = (Grant.NONE, Grant.ASSIGNED, Grant.VIEW_ONLY, Grant.ALL)

MATRIX: dict[Permission, dict[Role, Grant]] = {
    permission: {role: Grant(code) for role, code in zip(COLUMNS, codes, strict=True)}
    for permission, codes in ROWS.items()
}


def grant_for(role: Role, permission: Permission) -> Grant:
    return MATRIX[permission][role]


def role_of(principal: object) -> Role:
    if isinstance(principal, MemberPrincipal):
        return principal.role
    raise ForbiddenError


class ServiceScope(StrEnum):
    SEE_SLIDES = Permission.SEE_SLIDES.value
    CREATE_CASES = Permission.CREATE_CASES.value
    UPLOAD_SLIDES = Permission.UPLOAD_SLIDES.value
    SEE_PEOPLE = Permission.SEE_PEOPLE.value


def grant_of(principal: object, permission: Permission) -> Grant:
    if isinstance(principal, ServicePrincipal):
        return Grant.ALL if permission.value in principal.scopes else Grant.NONE
    return grant_for(role_of(principal), permission)


def narrower(first: Grant, second: Grant) -> Grant:
    return min(first, second, key=NARROWING.index)


def in_project(workspace: Grant, permission: Permission, role: ProjectRole | None) -> Grant:
    if role is None or workspace not in NARROWING:
        return Grant.NONE
    project = PROJECT_MATRIX[permission][role]
    if workspace is Grant.ASSIGNED and project is Grant.ALL:
        return Grant.VIEW_ONLY
    return narrower(workspace, project)


def may_ask_for_emergency_access(principal: object) -> bool:
    return grant_of(principal, Permission.EMERGENCY_ACCESS) is Grant.EMERGENCY


def require(
    permission: Permission, *, write: bool = False, emergency: bool = False
) -> dict[str, Any]:
    async def check(principal: CurrentPrincipal) -> Grant:
        grant = grant_of(principal, permission)
        if grant is Grant.NONE and emergency and may_ask_for_emergency_access(principal):
            return grant
        if grant is Grant.NONE or (write and grant is Grant.VIEW_ONLY):
            raise ForbiddenError
        return grant

    extra: dict[str, Any] = {"x-permission": permission.value}
    if write:
        extra["x-permission-write"] = True
    if emergency:
        extra["x-permission-emergency"] = True
    return {"dependencies": [Depends(check)], "openapi_extra": extra}
