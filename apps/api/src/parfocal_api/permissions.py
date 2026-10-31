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
}

ROLE_DUTIES = {
    Role.RESEARCHER: (
        "Runs studies. Creates projects and owns them, uploads slides and AI result files, "
        "runs models, sets a project's classes, opinion form and study template, creates "
        "review tasks and invites reviewers, resolves disagreements, signs off and exports "
        "the evaluation report. Reviews when a task names them. Opens a clinical project "
        "without a project role only through emergency access"
    ),
    Role.REVIEWER: (
        "Reviews the slides of their tasks. Gives verdicts with reasons and notes, fixes "
        "outlines and types, adds missed objects, fills the opinion form and submits each "
        "slide. Decides queued objects when a researcher makes them adjudicator. Never "
        "uploads, runs models, creates projects or tasks, signs off or holds admin rights"
    ),
}

ADMIN_RIGHTS_NAME = "Added by admin rights"

ADMIN_RIGHTS_DUTIES = (
    "A holder sets up the workspace: invites people and sets their role and admin rights, "
    "changes workspace and session settings, connects storage, sources, API tokens and "
    "webhooks, keeps the report template library, and reads and exports the audit log. "
    "Admin rights add no access to project data, and a workspace always keeps at least one "
    "holder"
)

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
    REPORT_TEMPLATES = "report-templates"
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
    Permission.MANAGE_PEOPLE: "Invite people, change roles and admin rights",
    Permission.WORKSPACE_SETTINGS: "Workspace settings and session security",
    Permission.INTEGRATIONS: "Storage, sources, API and webhooks",
    Permission.REPORT_TEMPLATES: "Use report templates, edit the library",
    Permission.AUDIT_LOG: "Audit log",
    Permission.DEVELOPER_MODE: "Developer mode and API tokens",
}

COLUMNS = (Role.RESEARCHER, Role.REVIEWER)

ROWS = {
    Permission.SEE_SLIDES: "yo",
    Permission.EMERGENCY_ACCESS: "bn",
    Permission.CREATE_CASES: "yn",
    Permission.UPLOAD_SLIDES: "yn",
    Permission.MOVE_SLIDES: "yn",
    Permission.REVIEW: "yo",
    Permission.SET_OWN_STATUS: "yy",
    Permission.SEE_PEOPLE: "yr",
    Permission.MANAGE_PEOPLE: "nn",
    Permission.WORKSPACE_SETTINGS: "rn",
    Permission.INTEGRATIONS: "rn",
    Permission.REPORT_TEMPLATES: "rn",
    Permission.AUDIT_LOG: "nn",
    Permission.DEVELOPER_MODE: "yn",
}

ADMIN_RIGHTS = frozenset(
    {
        Permission.MANAGE_PEOPLE,
        Permission.WORKSPACE_SETTINGS,
        Permission.INTEGRATIONS,
        Permission.REPORT_TEMPLATES,
        Permission.AUDIT_LOG,
    }
)

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


def grant_for(role: Role, permission: Permission, *, admin_rights: bool = False) -> Grant:
    if admin_rights and role is Role.RESEARCHER and permission in ADMIN_RIGHTS:
        return Grant.ALL
    return MATRIX[permission][role]


def member_of(principal: object) -> MemberPrincipal:
    if isinstance(principal, MemberPrincipal):
        return principal
    raise ForbiddenError


class ServiceScope(StrEnum):
    SEE_SLIDES = Permission.SEE_SLIDES.value
    CREATE_CASES = Permission.CREATE_CASES.value
    UPLOAD_SLIDES = Permission.UPLOAD_SLIDES.value
    SEE_PEOPLE = Permission.SEE_PEOPLE.value


def grant_of(principal: object, permission: Permission) -> Grant:
    if isinstance(principal, ServicePrincipal):
        return Grant.ALL if permission.value in principal.scopes else Grant.NONE
    member = member_of(principal)
    return grant_for(member.role, permission, admin_rights=member.admin_rights)


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
