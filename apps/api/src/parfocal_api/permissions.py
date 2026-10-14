from enum import StrEnum
from typing import Any

from fastapi import Depends

from parfocal_api.context import CurrentPrincipal
from parfocal_api.principals import GuestPrincipal, MemberPrincipal, ServicePrincipal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import Role

MEMBER_ROLES = tuple(role for role in Role if role is not Role.OUTSIDE_CONSULTANT)

ROLE_NAMES = {
    Role.CONSULTANT: "Consultant pathologist",
    Role.RESIDENT: "Resident",
    Role.LEAD: "Lab lead or head of department",
    Role.LAB: "Lab staff",
    Role.OUTSIDE_CONSULTANT: "Outside consultant",
    Role.ADMIN: "Administrator",
}


class Grant(StrEnum):
    ALL = "y"
    FOLDERS = "f"
    ASSIGNED = "o"
    NEEDS_CO_SIGN = "s"
    AS_SUPERVISOR = "p"
    SHARED = "c"
    MEASURE_AND_COMMENT = "m"
    VIEW_ONLY = "r"
    EMERGENCY = "b"
    NONE = "n"


GRANT_NAMES = {
    Grant.ALL: "Yes",
    Grant.FOLDERS: "In their folders",
    Grant.ASSIGNED: "Assigned to them",
    Grant.NEEDS_CO_SIGN: "Needs co-sign",
    Grant.AS_SUPERVISOR: "As named supervisor",
    Grant.SHARED: "Shared with them",
    Grant.MEASURE_AND_COMMENT: "Measure, comment",
    Grant.VIEW_ONLY: "View only",
    Grant.EMERGENCY: "Emergency, with reason",
    Grant.NONE: "No",
}


class Permission(StrEnum):
    SEE_CASES = "see-cases"
    OPEN_OUTSIDE_FOLDERS = "open-outside-folders"
    EDIT_CASES = "edit-cases"
    UPLOAD_SLIDES = "upload-slides"
    MOVE_SLIDES = "move-slides"
    CANCEL_CASES = "cancel-cases"
    TAKE_CASES = "take-cases"
    REASSIGN_CASES = "reassign-cases"
    ANNOTATE = "annotate"
    ORDER_LAB_WORK = "order-lab-work"
    DRAFT_REPORTS = "draft-reports"
    SIGN_OUT = "sign-out"
    CO_SIGN = "co-sign"
    AMEND_REPORTS = "amend-reports"
    ASK_SECOND_OPINION = "ask-second-opinion"
    GIVE_SECOND_OPINION = "give-second-opinion"
    SHARE_REPORTS = "share-reports"
    TUMOR_BOARDS = "tumor-boards"
    SET_OWN_STATUS = "set-own-status"
    SEE_TEAM = "see-team"
    MANAGE_PEOPLE = "manage-people"
    LAB_SETUP = "lab-setup"
    APPROVE_MODELS = "approve-models"
    INTEGRATIONS = "integrations"
    AUDIT_LOG = "audit-log"
    DEVELOPER_MODE = "developer-mode"


PERMISSION_NAMES = {
    Permission.SEE_CASES: "See cases",
    Permission.OPEN_OUTSIDE_FOLDERS: "Open a case outside their folders",
    Permission.EDIT_CASES: "Create a case, edit its details",
    Permission.UPLOAD_SLIDES: "Upload slides, fix unmatched slides",
    Permission.MOVE_SLIDES: "Move a slide between cases",
    Permission.CANCEL_CASES: "Cancel a case",
    Permission.TAKE_CASES: "Take or hand off their own cases",
    Permission.REASSIGN_CASES: "Reassign anyone's case",
    Permission.ANNOTATE: "Make calls, measure, annotate",
    Permission.ORDER_LAB_WORK: "Order lab work",
    Permission.DRAFT_REPORTS: "Draft the report",
    Permission.SIGN_OUT: "Sign out",
    Permission.CO_SIGN: "Co-sign a resident's report",
    Permission.AMEND_REPORTS: "Amend or add an addendum",
    Permission.ASK_SECOND_OPINION: "Ask for a second opinion",
    Permission.GIVE_SECOND_OPINION: "Give a second opinion",
    Permission.SHARE_REPORTS: "Share a signed report outside",
    Permission.TUMOR_BOARDS: "Prepare and present a tumor board",
    Permission.SET_OWN_STATUS: "Set their own status and absence",
    Permission.SEE_TEAM: "See the Team page and rota",
    Permission.MANAGE_PEOPLE: "Invite people, change roles and folders",
    Permission.LAB_SETUP: "Lab setup: rules, due times, AI plan, templates",
    Permission.APPROVE_MODELS: "Approve a model for a specimen",
    Permission.INTEGRATIONS: "Integrations and upload sources",
    Permission.AUDIT_LOG: "Audit log",
    Permission.DEVELOPER_MODE: "Developer mode",
}

COLUMNS = (
    Role.CONSULTANT,
    Role.RESIDENT,
    Role.LEAD,
    Role.LAB,
    Role.OUTSIDE_CONSULTANT,
    Role.ADMIN,
)

ROWS = {
    Permission.SEE_CASES: "ffyrcn",
    Permission.OPEN_OUTSIDE_FOLDERS: "bbynnb",
    Permission.EDIT_CASES: "fnyynn",
    Permission.UPLOAD_SLIDES: "yyyynn",
    Permission.MOVE_SLIDES: "onyynn",
    Permission.CANCEL_CASES: "nnynnn",
    Permission.TAKE_CASES: "yoynnn",
    Permission.REASSIGN_CASES: "nnynnn",
    Permission.ANNOTATE: "ooonmn",
    Permission.ORDER_LAB_WORK: "ooynnn",
    Permission.DRAFT_REPORTS: "ooonnn",
    Permission.SIGN_OUT: "osonnn",
    Permission.CO_SIGN: "pnynnn",
    Permission.AMEND_REPORTS: "onynnn",
    Permission.ASK_SECOND_OPINION: "ooynnn",
    Permission.GIVE_SECOND_OPINION: "ynyncn",
    Permission.SHARE_REPORTS: "onynnn",
    Permission.TUMOR_BOARDS: "yyynnn",
    Permission.SET_OWN_STATUS: "yyyyny",
    Permission.SEE_TEAM: "rryrny",
    Permission.MANAGE_PEOPLE: "nnynny",
    Permission.LAB_SETUP: "nnynnr",
    Permission.APPROVE_MODELS: "nnynnn",
    Permission.INTEGRATIONS: "nnrnny",
    Permission.AUDIT_LOG: "nnrnny",
    Permission.DEVELOPER_MODE: "nnnnny",
}

FOLDER_SCOPED = frozenset(
    {
        Permission.SEE_CASES,
        Permission.EDIT_CASES,
        Permission.UPLOAD_SLIDES,
        Permission.MOVE_SLIDES,
        Permission.TAKE_CASES,
        Permission.ANNOTATE,
        Permission.ORDER_LAB_WORK,
        Permission.ASK_SECOND_OPINION,
        Permission.TUMOR_BOARDS,
        Permission.SEE_TEAM,
    }
)

MATRIX: dict[Permission, dict[Role, Grant]] = {
    permission: {role: Grant(code) for role, code in zip(COLUMNS, codes, strict=True)}
    for permission, codes in ROWS.items()
}


def grant_for(role: Role, permission: Permission) -> Grant:
    return MATRIX[permission][role]


def role_of(principal: object) -> Role:
    if isinstance(principal, MemberPrincipal):
        return principal.role
    if isinstance(principal, GuestPrincipal):
        return Role.OUTSIDE_CONSULTANT
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


def require(permission: Permission, *, write: bool = False) -> dict[str, Any]:
    async def check(principal: CurrentPrincipal) -> Grant:
        grant = grant_of(principal, permission)
        if grant is Grant.NONE or (write and grant is Grant.VIEW_ONLY):
            raise ForbiddenError
        return grant

    extra: dict[str, Any] = {"x-permission": permission.value}
    if write:
        extra["x-permission-write"] = True
    return {"dependencies": [Depends(check)], "openapi_extra": extra}
