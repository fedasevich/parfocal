from enum import StrEnum
from typing import Any

from fastapi import Depends

from parfocal_api.context import CurrentPrincipal
from parfocal_api.principals import MemberPrincipal, ServicePrincipal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import Role

ROLE_NAMES = {
    Role.CONSULTANT: "Consultant pathologist",
    Role.RESIDENT: "Resident",
    Role.LEAD: "Lab lead or head of department",
    Role.LAB: "Lab staff",
    Role.ADMIN: "Administrator",
}


class Grant(StrEnum):
    ALL = "y"
    ASSIGNED = "o"
    VIEW_ONLY = "r"
    EMERGENCY = "b"
    NONE = "n"


GRANT_NAMES = {
    Grant.ALL: "Yes",
    Grant.ASSIGNED: "Assigned to them",
    Grant.VIEW_ONLY: "View only",
    Grant.EMERGENCY: "Emergency, with reason",
    Grant.NONE: "No",
}


class Permission(StrEnum):
    SEE_CASES = "see-cases"
    EMERGENCY_ACCESS = "emergency-access"
    EDIT_CASES = "edit-cases"
    UPLOAD_SLIDES = "upload-slides"
    MOVE_SLIDES = "move-slides"
    ANNOTATE = "annotate"
    SET_OWN_STATUS = "set-own-status"
    SEE_TEAM = "see-team"
    MANAGE_PEOPLE = "manage-people"
    LAB_SETUP = "lab-setup"
    INTEGRATIONS = "integrations"
    AUDIT_LOG = "audit-log"
    DEVELOPER_MODE = "developer-mode"


PERMISSION_NAMES = {
    Permission.SEE_CASES: "See cases",
    Permission.EMERGENCY_ACCESS: "Open a case their role does not reach",
    Permission.EDIT_CASES: "Create a case, edit its details",
    Permission.UPLOAD_SLIDES: "Upload slides, fix unmatched slides",
    Permission.MOVE_SLIDES: "Move a slide between cases",
    Permission.ANNOTATE: "Make calls, measure, annotate",
    Permission.SET_OWN_STATUS: "Set their own status and absence",
    Permission.SEE_TEAM: "See the Team page and rota",
    Permission.MANAGE_PEOPLE: "Invite people, change roles",
    Permission.LAB_SETUP: "Lab setup: rules, due times, AI plan, templates",
    Permission.INTEGRATIONS: "Integrations and upload sources",
    Permission.AUDIT_LOG: "Audit log",
    Permission.DEVELOPER_MODE: "Developer mode",
}

COLUMNS = (
    Role.CONSULTANT,
    Role.RESIDENT,
    Role.LEAD,
    Role.LAB,
    Role.ADMIN,
)

ROWS = {
    Permission.SEE_CASES: "yyyrn",
    Permission.EMERGENCY_ACCESS: "nnnnb",
    Permission.EDIT_CASES: "ynyyn",
    Permission.UPLOAD_SLIDES: "yyyyn",
    Permission.MOVE_SLIDES: "onyyn",
    Permission.ANNOTATE: "ooonn",
    Permission.SET_OWN_STATUS: "yyyyy",
    Permission.SEE_TEAM: "rryry",
    Permission.MANAGE_PEOPLE: "nnyny",
    Permission.LAB_SETUP: "nnynr",
    Permission.INTEGRATIONS: "nnrny",
    Permission.AUDIT_LOG: "nnrny",
    Permission.DEVELOPER_MODE: "nnnny",
}

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
    SEE_CASES = Permission.SEE_CASES.value
    EDIT_CASES = Permission.EDIT_CASES.value
    UPLOAD_SLIDES = Permission.UPLOAD_SLIDES.value
    SEE_TEAM = Permission.SEE_TEAM.value


def grant_of(principal: object, permission: Permission) -> Grant:
    if isinstance(principal, ServicePrincipal):
        return Grant.ALL if permission.value in principal.scopes else Grant.NONE
    return grant_for(role_of(principal), permission)


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
