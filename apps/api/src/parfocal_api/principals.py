import uuid
from dataclasses import dataclass

from parfocal_common.db import DatabaseScope


@dataclass(frozen=True)
class SignedInUser:
    subject: str


@dataclass(frozen=True)
class MemberPrincipal:
    subject: str
    tenant_id: uuid.UUID


@dataclass(frozen=True)
class GuestGrant:
    host_tenant_id: uuid.UUID
    case_id: uuid.UUID
    view_id: uuid.UUID | None = None


@dataclass(frozen=True)
class GuestPrincipal:
    subject: str
    grant: GuestGrant | None


@dataclass(frozen=True)
class PlatformOperator:
    subject: str


type Principal = SignedInUser | MemberPrincipal | GuestPrincipal | PlatformOperator


class MissingGuestGrantError(Exception):
    def __init__(self) -> None:
        super().__init__("A guest has no database scope without an active grant")


def database_scope(principal: Principal) -> DatabaseScope:
    match principal:
        case SignedInUser():
            return DatabaseScope()
        case MemberPrincipal(tenant_id=tenant_id):
            return DatabaseScope(tenant_id=tenant_id)
        case GuestPrincipal(grant=GuestGrant(host_tenant_id=host, case_id=case, view_id=view)):
            return DatabaseScope(tenant_id=host, case_id=case, view_id=view)
        case GuestPrincipal():
            raise MissingGuestGrantError
        case PlatformOperator():
            return DatabaseScope(platform=True)
