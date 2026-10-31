import uuid
from dataclasses import dataclass

from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope


@dataclass(frozen=True)
class SignedInUser:
    subject: str
    user_id: uuid.UUID


@dataclass(frozen=True)
class MemberPrincipal:
    subject: str
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    role: Role
    admin_rights: bool = False


@dataclass(frozen=True)
class PlatformOperator:
    subject: str


@dataclass(frozen=True)
class ServicePrincipal:
    account_id: uuid.UUID
    tenant_id: uuid.UUID
    scopes: frozenset[str]


type Principal = SignedInUser | MemberPrincipal | PlatformOperator | ServicePrincipal


def database_scope(principal: Principal) -> DatabaseScope:
    match principal:
        case SignedInUser(user_id=user_id):
            return DatabaseScope(user_id=user_id)
        case MemberPrincipal(tenant_id=tenant_id, user_id=user_id):
            return DatabaseScope(tenant_id=tenant_id, user_id=user_id)
        case PlatformOperator():
            return DatabaseScope(platform=True)
        case ServicePrincipal(tenant_id=tenant_id):
            return DatabaseScope(tenant_id=tenant_id)
