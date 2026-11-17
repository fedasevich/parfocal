import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from urllib.parse import urlparse

import httpx2
import pytest
from db_support import APP_URL, OWNER_URL, TEST_MASTER_KEYS, migrated_database, query, with_database
from storage_support import TEST_STORAGE, stored_keys, with_store
from test_tenant_command import local_zitadel, organisations_named

from parfocal_api.tenant_provisioning import storage_prefix
from parfocal_common.object_store import ObjectStore

LOCAL_HOSTS = {"localhost", "127.0.0.1"}

pytestmark = pytest.mark.skipif(
    os.environ.get("PARFOCAL_DRILL") != "1",
    reason="The tenant drill runs only with PARFOCAL_DRILL=1 against the local stack",
)


def require_local(name: str, url: str) -> None:
    if urlparse(url).hostname not in LOCAL_HOSTS:
        pytest.fail(f"The tenant drill deletes data, so {name} must be local, not {url}")


@pytest.fixture
def stack_zitadel() -> dict[str, str]:
    found = local_zitadel()
    if "ZITADEL_ADMIN_TOKEN" not in found:
        pytest.fail("PARFOCAL_DRILL=1 needs .zitadel/e2e.env from pnpm stack:up")
    require_local("ZITADEL_ISSUER", found["ZITADEL_ISSUER"])
    httpx2.get(f"{found['ZITADEL_ISSUER']}/debug/healthz", timeout=5).raise_for_status()
    return found


@pytest.fixture
def drill_database() -> Iterator[str]:
    require_local("the database", OWNER_URL)
    require_local("the database", APP_URL)
    with migrated_database() as name:
        yield name


def drill_environment(database: str, zitadel: dict[str, str]) -> dict[str, str]:
    require_local("STORAGE_ENDPOINT", TEST_STORAGE.endpoint)
    return {
        "PATH": os.environ["PATH"],
        "HOME": os.environ.get("HOME", "/tmp"),
        "APP_ENV": "test",
        "DATABASE_URL": with_database(APP_URL, database),
        "MASTER_KEYS": TEST_MASTER_KEYS,
        "ZITADEL_ISSUER": zitadel["ZITADEL_ISSUER"],
        "ZITADEL_ADMIN_TOKEN": zitadel["ZITADEL_ADMIN_TOKEN"],
        "STORAGE_ENDPOINT": TEST_STORAGE.endpoint,
        "STORAGE_REGION": TEST_STORAGE.region,
        "STORAGE_BUCKET": TEST_STORAGE.bucket,
        "STORAGE_ACCESS_KEY_ID": TEST_STORAGE.access_key_id,
        "STORAGE_SECRET_ACCESS_KEY": TEST_STORAGE.secret_access_key,
    }


def tenant_command(environment: dict[str, str], *argv: str) -> str:
    finished = subprocess.run(
        [sys.executable, "-m", "parfocal_api.tenant_command", *argv],
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert finished.returncode == 0, finished.stderr
    assert environment["ZITADEL_ADMIN_TOKEN"] not in finished.stdout + finished.stderr
    return finished.stdout.strip()


def remove_organisations(zitadel: dict[str, str], name: str) -> None:
    for organisation_id in organisations_named(zitadel, name):
        httpx2.delete(
            f"{zitadel['ZITADEL_ISSUER']}/v2/organizations/{organisation_id}",
            headers={"authorization": f"Bearer {zitadel['ZITADEL_ADMIN_TOKEN']}"},
        )


def put_tenant_objects(prefix: str, names: list[str]) -> None:
    async def work(store: ObjectStore) -> None:
        for name in names:
            await store.put_object(f"{prefix}{name}", b"drill", "application/octet-stream")

    with_store(work)


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_the_drill_provisions_and_deprovisions_a_tenant_leaving_nothing_behind(
    drill_database: str, stack_zitadel: dict[str, str]
) -> None:
    environment = drill_environment(drill_database, stack_zitadel)
    slug = f"drill-{uuid.uuid4().hex[:8]}"
    organisation = f"parfocal-{slug}"
    owner = with_database(OWNER_URL, drill_database)
    try:
        tenant_id = tenant_command(
            environment,
            "provision",
            "--organisation-slug",
            f"org-{slug}",
            "--organisation-name",
            f"Organisation {slug}",
            "--slug",
            slug,
            "--name",
            f"Workspace {slug}",
            "--kind",
            "research",
        )
        tenant = uuid.UUID(tenant_id)
        prefix = storage_prefix(tenant)
        assert query(owner, f"SELECT status FROM tenants WHERE id = '{tenant}'") == [("active",)]
        assert query(owner, f"SELECT count(*) FROM tenant_keys WHERE tenant_id = '{tenant}'") == [
            (2,)
        ]
        assert len(organisations_named(stack_zitadel, organisation)) == 1

        put_tenant_objects(prefix, ["slides/a/original.svs", "slides/a/tiles/0_0.jpg", "e.json"])
        assert len(stored_keys(prefix)) == 3

        removed = tenant_command(environment, "deprovision", tenant_id)
        assert removed == (
            f"{tenant_id} objects_removed=3 keys_shredded=2 idp_organisation_removed=true"
        )
        assert organisations_named(stack_zitadel, organisation) == []
        assert stored_keys(prefix) == []
        assert query(owner, f"SELECT count(*) FROM tenant_keys WHERE tenant_id = '{tenant}'") == [
            (0,)
        ]
        assert query(owner, f"SELECT status FROM tenants WHERE id = '{tenant}'") == [("suspended",)]
        assert query(
            owner,
            "SELECT action FROM audit_events "
            f"WHERE tenant_id = '{tenant}' AND action = 'tenant.deprovisioned'",
        ) == [("tenant.deprovisioned",)]
    finally:
        remove_organisations(stack_zitadel, organisation)
