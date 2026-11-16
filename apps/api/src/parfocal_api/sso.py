import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import ColumnElement, any_, literal, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.tables import ActorKind, Role, memberships, sso_connections
from parfocal_common.db import SET_SCOPE, DatabaseScope

RESOURCE_OWNER_CLAIM = "urn:zitadel:iam:user:resourceowner:id"
METADATA_CLAIM = "urn:zitadel:iam:user:metadata"
METADATA_SCOPE = "urn:zitadel:iam:user:metadata"
GROUPS_KEY = "parfocal_groups"
ROLE_PRECEDENCE = (Role.RESEARCHER, Role.REVIEWER)
SSO_SOURCE = {"source": "sso"}
AUTH_ONLY = DatabaseScope(auth=True)


@dataclass(frozen=True)
class SsoConnection:
    tenant_id: uuid.UUID
    idp_organisation_id: str
    idp_id: str
    email_domains: tuple[str, ...]
    default_role: Role | None
    group_roles: dict[str, Role]

    def scopes(self) -> tuple[str, ...]:
        return (
            METADATA_SCOPE,
            f"urn:zitadel:iam:org:id:{self.idp_organisation_id}",
            f"urn:zitadel:iam:org:idp:id:{self.idp_id}",
        )

    def vouches_for(self, email: str) -> bool:
        return domain_of(email) in self.email_domains

    def role_for(self, groups: list[str]) -> Role | None:
        granted = {self.group_roles[group] for group in groups if group in self.group_roles}
        for role in ROLE_PRECEDENCE:
            if role in granted:
                return role
        return self.default_role


def domain_of(email: str) -> str:
    return email.rpartition("@")[2].strip().lower()


def connection_of(row: Any) -> SsoConnection:
    return SsoConnection(
        tenant_id=row.tenant_id,
        idp_organisation_id=row.idp_organisation_id,
        idp_id=row.idp_id,
        email_domains=tuple(domain.lower() for domain in row.email_domains),
        default_role=Role(row.default_role) if row.default_role else None,
        group_roles={str(group): Role(role) for group, role in row.group_roles.items()},
    )


async def connection_for_organisation(
    connection: AsyncConnection, idp_organisation_id: str
) -> SsoConnection | None:
    row = (
        await connection.execute(
            select(sso_connections).where(
                sso_connections.c.idp_organisation_id == idp_organisation_id
            )
        )
    ).one_or_none()
    return connection_of(row) if row is not None else None


async def connection_for_domain(connection: AsyncConnection, domain: str) -> SsoConnection | None:
    rows = (
        await connection.execute(
            select(sso_connections).where(using_domain(domain_of(domain))).limit(2)
        )
    ).all()
    return connection_of(rows[0]) if len(rows) == 1 else None


def using_domain(domain: str) -> ColumnElement[bool]:
    return literal(domain) == any_(sso_connections.c.email_domains)


def groups_of(claims: dict[str, Any]) -> list[str]:
    metadata: object = claims.get(METADATA_CLAIM)
    if not isinstance(metadata, dict):
        return []
    encoded: object = cast("dict[str, object]", metadata).get(GROUPS_KEY)
    if not isinstance(encoded, str):
        return []
    try:
        decoded: object = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except binascii.Error, UnicodeDecodeError, ValueError:
        return []
    if isinstance(decoded, str):
        return [decoded]
    if isinstance(decoded, list):
        return [str(group) for group in cast("list[object]", decoded)]
    return []


async def sso_connection_of(
    connection: AsyncConnection, claims: dict[str, Any]
) -> SsoConnection | None:
    organisation = claims.get(RESOURCE_OWNER_CLAIM)
    if not isinstance(organisation, str):
        return None
    return await connection_for_organisation(connection, organisation)


async def provision_member(
    connection: AsyncConnection,
    sso: SsoConnection,
    user_id: uuid.UUID,
    subject: str,
    claims: dict[str, Any],
) -> uuid.UUID | None:
    if METADATA_CLAIM not in claims:
        return None
    role = sso.role_for(groups_of(claims))
    if role is None:
        return None
    await connection.execute(
        SET_SCOPE, DatabaseScope(tenant_id=sso.tenant_id, auth=True).parameters()
    )
    try:
        current = await connection.scalar(
            select(memberships.c.role).where(
                memberships.c.tenant_id == sso.tenant_id, memberships.c.user_id == user_id
            )
        )
        actor = Actor(ActorKind.USER, subject)
        if current is None:
            await connection.execute(
                upsert(memberships)
                .values(tenant_id=sso.tenant_id, user_id=user_id, role=role)
                .on_conflict_do_nothing()
            )
            await record(
                connection,
                actor,
                AuditAction.MEMBER_ADDED,
                AuditTarget.PERSON,
                person=subject,
                tenant_id=sso.tenant_id,
                details={"role": role.value, "admin_rights": False} | SSO_SOURCE,
            )
        elif current != role:
            await connection.execute(
                update(memberships)
                .where(memberships.c.tenant_id == sso.tenant_id, memberships.c.user_id == user_id)
                .values(
                    role=role,
                    admin_rights=memberships.c.admin_rights if role is Role.RESEARCHER else False,
                )
            )
            await record(
                connection,
                actor,
                AuditAction.MEMBER_ROLE_CHANGED,
                AuditTarget.PERSON,
                person=subject,
                tenant_id=sso.tenant_id,
                details={"from": current, "to": role.value} | SSO_SOURCE,
            )
    finally:
        await connection.execute(SET_SCOPE, AUTH_ONLY.parameters())
    return sso.tenant_id
