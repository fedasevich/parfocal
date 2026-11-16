from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, func, text

from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.residency import Region as Region

SLUG_PATTERN = "^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"
DEFAULT_IDLE_LOCK_MINUTES = 15
DEFAULT_SESSION_HOURS = 12
DEFAULT_EMERGENCY_HOURS = 4


class TenantKind(StrEnum):
    DIAGNOSTIC = "diagnostic"
    RESEARCH = "research"
    SECOND_OPINION = "second-opinion"


class Plan(StrEnum):
    PILOT = "pilot"


class Role(StrEnum):
    RESEARCHER = "researcher"
    REVIEWER = "reviewer"


MEMBER_ROLE_CHECK = "role IN ('researcher', 'reviewer')"
ADMIN_RIGHTS_CHECK = "NOT admin_rights OR role = 'researcher'"


def admin_rights_column() -> Column[bool]:
    return Column(
        "admin_rights", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL
    )


class ProjectRole(StrEnum):
    OWNER = "owner"
    REVIEWER = "reviewer"
    VIEWER = "viewer"


class SignOutRight(StrEnum):
    OWN_CASES = "own"
    ANY_CASE = "any"
    NEVER = "never"


class Availability(StrEnum):
    AVAILABLE = "available"
    AWAY = "away"


AVAILABILITY_CHECK = (
    "availability = 'away'"
    " OR (availability = 'available' AND available_again_at IS NULL AND availability_note IS NULL)"
)


class TenantStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class JoinPolicy(StrEnum):
    JOIN = "join"
    ASK = "ask"


LOGO_PATTERN = "^[A-Z0-9]{1,3}$"
LOGO_COLOUR_PATTERN = "^#[0-9a-f]{6}$"


def one_of(column: str, values: type[StrEnum]) -> CheckConstraint:
    allowed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{column} IN ({allowed})", name=column)


def timestamps() -> list[Column[datetime]]:
    return [
        Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            info=OPERATIONAL,
        ),
        Column(
            "updated_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            info=OPERATIONAL,
        ),
    ]
