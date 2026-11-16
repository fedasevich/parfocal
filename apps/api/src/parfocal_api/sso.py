import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import ColumnElement, any_, func, insert, literal, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.tables import (
    ActorKind,
    Role,
    linked_subjects,
    memberships,
    platform_operators,
    sso_connections,
    users,
)
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
    proven_domains: frozenset[str]
    default_role: Role | None
    group_roles: dict[str, Role]

    def scopes(self) -> tuple[str, ...]:
        return (
            METADATA_SCOPE,
            f"urn:zitadel:iam:org:id:{self.idp_organisation_id}",
            f"urn:zitadel:iam:org:idp:id:{self.idp_id}",
        )

    def vouches_for(self, email: str) -> bool:
        return domain_of(email) in self.proven_domains

    def role_for(self, groups: list[str]) -> Role | None:
        granted = {self.group_roles[group] for group in groups if group in self.group_roles}
        for role in ROLE_PRECEDENCE:
            if role in granted:
                return role
        return self.default_role


def domain_of(email: str) -> str:
    return email.rpartition("@")[2].strip().lower()


def proven_domains_of(proofs: dict[str, Any]) -> frozenset[str]:
    return frozenset(
        domain.lower()
        for domain, proof in proofs.items()
        if isinstance(proof, dict) and cast("dict[str, object]", proof).get("proven_at")
    )


def connection_of(row: Any) -> SsoConnection:
    domains = tuple(domain.lower() for domain in row.email_domains)
    return SsoConnection(
        tenant_id=row.tenant_id,
        idp_organisation_id=row.idp_organisation_id,
        idp_id=row.idp_id,
        email_domains=domains,
        proven_domains=proven_domains_of(row.domain_proofs).intersection(domains),
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
    wanted = domain_of(domain)
    rows = (
        await connection.execute(select(sso_connections).where(using_domain(wanted)).limit(2))
    ).all()
    if len(rows) != 1:
        return None
    found = connection_of(rows[0])
    return found if wanted in found.proven_domains else None


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


async def linked_subject(
    connection: AsyncConnection, subject: str, sso: SsoConnection | None, email: str | None
) -> str:
    linked = await connection.scalar(
        select(users.c.subject)
        .join(linked_subjects, linked_subjects.c.user_id == users.c.id)
        .where(linked_subjects.c.subject == subject)
    )
    if linked is not None:
        return str(linked)
    if sso is None or email is None or not sso.vouches_for(email):
        return subject
    if await connection.scalar(select(users.c.id).where(users.c.subject == subject)) is not None:
        return subject
    matches = (
        await connection.execute(
            select(users.c.id, users.c.subject)
            .where(
                func.lower(users.c.email) == email.lower(),
                users.c.subject.not_in(select(platform_operators.c.subject)),
            )
            .limit(2)
        )
    ).all()
    if len(matches) != 1:
        return subject
    account = matches[0]
    await connection.execute(
        insert(linked_subjects).values(
            subject=subject, user_id=account.id, sso_tenant_id=sso.tenant_id
        )
    )
    await connection.execute(
        SET_SCOPE, DatabaseScope(tenant_id=sso.tenant_id, auth=True).parameters()
    )
    try:
        await record(
            connection,
            Actor(ActorKind.USER, str(account.subject)),
            AuditAction.USER_SSO_LINKED,
            AuditTarget.PERSON,
            person=str(account.subject),
            tenant_id=sso.tenant_id,
            details=SSO_SOURCE,
        )
    finally:
        await connection.execute(SET_SCOPE, AUTH_ONLY.parameters())
    return str(account.subject)


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
