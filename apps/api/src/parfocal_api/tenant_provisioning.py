import uuid
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.identifiers import ensure_keys, shred_keys
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
    ActorKind,
    Plan,
    Region,
    TenantKind,
    TenantStatus,
    organisations,
    sso_connections,
    tenants,
)
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.object_store import ObjectStore

PLATFORM = DatabaseScope(platform=True)
PROVISIONER = Actor(ActorKind.SYSTEM, "tenant-provisioning")


class IdentityDirectory(Protocol):
    async def ensure_organisation(self, name: str) -> str: ...

    async def find_organisation(self, name: str) -> str | None: ...

    async def remove_organisation(self, organisation_id: str) -> None: ...


@dataclass(frozen=True)
class TenantRequest:
    organisation_slug: str
    organisation_name: str
    slug: str
    name: str
    kind: TenantKind
    region: Region
    plan: Plan = Plan.PILOT


@dataclass(frozen=True)
class Provisioned:
    tenant_id: uuid.UUID
    organisation_id: uuid.UUID
    idp_organisation_id: str
    storage_prefix: str


@dataclass(frozen=True)
class Deprovisioned:
    tenant_id: uuid.UUID
    objects_removed: int
    keys_shredded: int
    idp_organisation_removed: bool


def storage_prefix(tenant_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/"


def idp_organisation_name(slug: str) -> str:
    return f"parfocal-{slug}"


async def provision(
    engine: AsyncEngine,
    keyring: MasterKeyring,
    store: ObjectStore,
    directory: IdentityDirectory,
    request: TenantRequest,
) -> Provisioned:
    async with scoped_transaction(engine, PLATFORM) as connection:
        organisation_id = await connection.scalar(
            select(organisations.c.id).where(organisations.c.slug == request.organisation_slug)
        )
        if organisation_id is None:
            organisation_id = await connection.scalar(
                insert(organisations)
                .values(slug=request.organisation_slug, name=request.organisation_name)
                .returning(organisations.c.id)
            )
            await record(
                connection,
                PROVISIONER,
                AuditAction.ORGANISATION_CREATED,
                AuditTarget.ORGANISATION,
                organisation_id,
            )
        assert isinstance(organisation_id, uuid.UUID)
        tenant_id = await connection.scalar(
            insert(tenants)
            .values(
                organisation_id=organisation_id,
                slug=request.slug,
                name=request.name,
                kind=request.kind,
                region=request.region,
                plan=request.plan,
            )
            .returning(tenants.c.id)
        )
        assert isinstance(tenant_id, uuid.UUID)
        await seed_built_ins(connection, tenant_id)
        await ensure_keys(connection, keyring, tenant_id)
        await record(
            connection,
            PROVISIONER,
            AuditAction.TENANT_CREATED,
            AuditTarget.TENANT,
            tenant_id,
            tenant_id=tenant_id,
        )
    await store.create_bucket()
    idp_organisation_id = await directory.ensure_organisation(idp_organisation_name(request.slug))
    return Provisioned(tenant_id, organisation_id, idp_organisation_id, storage_prefix(tenant_id))


async def deprovision(
    engine: AsyncEngine,
    store: ObjectStore,
    directory: IdentityDirectory,
    tenant_id: uuid.UUID,
) -> Deprovisioned:
    async with scoped_transaction(engine, PLATFORM) as connection:
        slug = await connection.scalar(
            update(tenants)
            .where(tenants.c.id == tenant_id)
            .values(
                status=TenantStatus.SUSPENDED,
                suspended_at=func.coalesce(tenants.c.suspended_at, func.now()),
            )
            .returning(tenants.c.slug)
        )
        await connection.execute(
            delete(sso_connections).where(sso_connections.c.tenant_id == tenant_id)
        )
    if slug is None:
        raise LookupError(f"tenant {tenant_id} does not exist")
    idp_organisation_id = await directory.find_organisation(idp_organisation_name(slug))
    if idp_organisation_id is not None:
        await directory.remove_organisation(idp_organisation_id)
    keys = await store.list_keys(storage_prefix(tenant_id))
    for key in keys:
        await store.delete_object(key)
    async with scoped_transaction(engine, PLATFORM) as connection:
        shredded = await shred_keys(connection, tenant_id)
        await record(
            connection,
            PROVISIONER,
            AuditAction.TENANT_DEPROVISIONED,
            AuditTarget.TENANT,
            tenant_id,
            tenant_id=tenant_id,
            details={"objects_removed": len(keys), "keys_shredded": shredded},
        )
    return Deprovisioned(tenant_id, len(keys), shredded, idp_organisation_id is not None)
