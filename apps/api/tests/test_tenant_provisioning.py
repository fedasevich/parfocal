import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field

import httpx2
import pytest
from db_support import APP_URL, OWNER_URL, migrated_database, query, with_database
from sqlalchemy.ext.asyncio import AsyncEngine
from storage_support import TEST_STORAGE
from test_identifiers import KEYRING

from parfocal_api.identifiers import load_keys
from parfocal_api.tables import Region, TenantKind
from parfocal_api.tenant_provisioning import (
    PLATFORM,
    Deprovisioned,
    Provisioned,
    TenantRequest,
    deprovision,
    provision,
    storage_prefix,
)
from parfocal_common.db import create_engine, scoped_transaction
from parfocal_common.envelope import DataKeyUnavailableError
from parfocal_common.object_store import ObjectStore

pytestmark = pytest.mark.db


@dataclass
class FakeDirectory:
    organisations: dict[str, str] = field(default_factory=dict[str, str])

    async def ensure_organisation(self, name: str) -> str:
        return self.organisations.setdefault(name, f"idp-{uuid.uuid4().hex[:8]}")

    async def find_organisation(self, name: str) -> str | None:
        return self.organisations.get(name)

    async def remove_organisation(self, organisation_id: str) -> None:
        self.organisations = {
            name: found for name, found in self.organisations.items() if found != organisation_id
        }


@pytest.fixture
def drill() -> Iterator[str]:
    with migrated_database() as name:
        yield name


def against[T](database: str, work: Callable[[ObjectStore, AsyncEngine], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with httpx2.AsyncClient(timeout=30) as http:
                return await work(ObjectStore(TEST_STORAGE, http), engine)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def request(slug: str) -> TenantRequest:
    return TenantRequest(
        organisation_slug=f"org-{slug}",
        organisation_name=f"Organisation {slug}",
        slug=slug,
        name=f"Workspace {slug}",
        kind=TenantKind.RESEARCH,
        region=Region.EU,
    )


def provisioned(database: str, directory: FakeDirectory, slug: str) -> Provisioned:
    async def work(store: ObjectStore, engine: AsyncEngine) -> Provisioned:
        created = await provision(engine, KEYRING, store, directory, request(slug))
        await store.put_object(
            f"{created.storage_prefix}s/x/original.svs", b"slide", "application/octet-stream"
        )
        return created

    return against(database, work)


def removed(database: str, directory: FakeDirectory, tenant_id: uuid.UUID) -> Deprovisioned:
    return against(
        database,
        lambda store, engine: deprovision(engine, store, directory, tenant_id),
    )


def stored(database: str, tenant_id: uuid.UUID) -> list[str]:
    return against(database, lambda store, _: store.list_keys(storage_prefix(tenant_id)))


def keys_load(database: str, tenant_id: uuid.UUID) -> bool:
    async def work(_: ObjectStore, engine: AsyncEngine) -> bool:
        async with scoped_transaction(engine, PLATFORM) as connection:
            try:
                await load_keys(connection, KEYRING, tenant_id)
            except DataKeyUnavailableError:
                return False
            return True

    return against(database, work)


def owner_rows(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def test_a_tenant_is_provisioned_and_deprovisioned_in_one_call_each(drill: str) -> None:
    directory = FakeDirectory()
    slug = f"drill-{uuid.uuid4().hex[:8]}"
    kept_slug = f"kept-{uuid.uuid4().hex[:8]}"
    tenant = provisioned(drill, directory, slug)
    kept = provisioned(drill, directory, kept_slug)

    assert owner_rows(
        drill, f"SELECT status, region FROM tenants WHERE id = '{tenant.tenant_id}'"
    ) == [("active", "eu")]
    assert owner_rows(
        drill,
        f"SELECT count(DISTINCT purpose) FROM tenant_keys WHERE tenant_id = '{tenant.tenant_id}'",
    ) == [(2,)]
    assert keys_load(drill, tenant.tenant_id)
    assert set(directory.organisations) == {f"parfocal-{slug}", f"parfocal-{kept_slug}"}
    assert stored(drill, tenant.tenant_id) == [f"{tenant.storage_prefix}s/x/original.svs"]

    first = removed(drill, directory, tenant.tenant_id)
    assert (first.objects_removed, first.keys_shredded, first.idp_organisation_removed) == (
        1,
        2,
        True,
    )
    assert owner_rows(drill, f"SELECT status FROM tenants WHERE id = '{tenant.tenant_id}'") == [
        ("suspended",)
    ]
    assert not keys_load(drill, tenant.tenant_id)
    assert stored(drill, tenant.tenant_id) == []
    assert set(directory.organisations) == {f"parfocal-{kept_slug}"}
    assert owner_rows(
        drill,
        "SELECT count(*) FROM audit_events "
        f"WHERE target_id = '{tenant.tenant_id}' AND action = 'tenant.deprovisioned'",
    ) == [(1,)]

    again = removed(drill, directory, tenant.tenant_id)
    assert (again.objects_removed, again.keys_shredded, again.idp_organisation_removed) == (
        0,
        0,
        False,
    )

    assert keys_load(drill, kept.tenant_id)
    assert stored(drill, kept.tenant_id) == [f"{kept.storage_prefix}s/x/original.svs"]
    removed(drill, directory, kept.tenant_id)


def test_deprovisioning_an_unknown_tenant_changes_nothing(drill: str) -> None:
    with pytest.raises(LookupError):
        removed(drill, FakeDirectory(), uuid.uuid4())
