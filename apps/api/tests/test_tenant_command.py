import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable, Iterator
from pathlib import Path
from urllib.parse import urlparse

import httpx2
import pytest
from db_support import APP_URL, OWNER_URL, TEST_MASTER_KEYS, migrated_database, query, with_database
from storage_support import TEST_STORAGE

from parfocal_api.tenant_command import ProvisioningSettings, main
from parfocal_api.zitadel_directory import (
    ACTIVE,
    AmbiguousOrganisationError,
    DirectoryError,
    ZitadelDirectory,
)

LOCAL_ZITADEL = Path(__file__).resolve().parents[3] / ".zitadel/e2e.env"


def local_zitadel() -> dict[str, str]:
    if not LOCAL_ZITADEL.is_file():
        return {}
    lines = LOCAL_ZITADEL.read_text().splitlines()
    return dict(line.split("=", 1) for line in lines if "=" in line)


class FakeZitadel:
    def __init__(self) -> None:
        self.organisations: list[dict[str, str]] = []
        self.create_status = 201

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        if request.headers.get("authorization") != "Bearer admin":
            return httpx2.Response(401, json={"code": 16})
        if request.url.path == "/v2/organizations/_search":
            name = json.loads(request.content)["queries"][0]["nameQuery"]["name"]
            found = [o for o in self.organisations if o["name"].startswith(name)]
            return httpx2.Response(200, json={"result": found} if found else {})
        if request.url.path == "/v2/organizations" and request.method == "POST":
            if self.create_status != 201:
                return httpx2.Response(self.create_status, json={"code": 6})
            name = json.loads(request.content)["name"]
            organisation_id = f"org-{len(self.organisations)}"
            self.organisations.append({"id": organisation_id, "name": name, "state": ACTIVE})
            return httpx2.Response(201, json={"organizationId": organisation_id})
        if request.method == "DELETE":
            organisation_id = request.url.path.rsplit("/", 1)[-1]
            if organisation_id == "broken":
                return httpx2.Response(500, json={})
            if not any(o["id"] == organisation_id for o in self.organisations):
                return httpx2.Response(404, json={"code": 5})
            self.organisations = [o for o in self.organisations if o["id"] != organisation_id]
            return httpx2.Response(200, json={})
        return httpx2.Response(404, json={})


def against_fake[T](
    zitadel: FakeZitadel, token: str, work: Callable[[ZitadelDirectory], Awaitable[T]]
) -> T:
    async def go() -> T:
        transport = httpx2.MockTransport(zitadel.handle)
        async with httpx2.AsyncClient(transport=transport) as http:
            return await work(ZitadelDirectory("http://zitadel.test/", token, http))

    return asyncio.run(go())


def test_the_directory_creates_an_organisation_once_and_finds_it_by_exact_name() -> None:
    zitadel = FakeZitadel()
    zitadel.organisations.append({"id": "other", "name": "parfocal-a-b", "state": ACTIVE})

    async def work(directory: ZitadelDirectory) -> tuple[str, str, str | None]:
        first = await directory.ensure_organisation("parfocal-a")
        again = await directory.ensure_organisation("parfocal-a")
        return first, again, await directory.find_organisation("parfocal-missing")

    first, again, missing = against_fake(zitadel, "admin", work)
    assert first == again == "org-1"
    assert missing is None
    assert [o["name"] for o in zitadel.organisations] == ["parfocal-a-b", "parfocal-a"]


def test_the_directory_ignores_inactive_and_refuses_ambiguous_organisations() -> None:
    zitadel = FakeZitadel()
    zitadel.organisations.append({"id": "gone", "name": "parfocal-x", "state": "INACTIVE"})

    async def inactive(directory: ZitadelDirectory) -> str | None:
        return await directory.find_organisation("parfocal-x")

    assert against_fake(zitadel, "admin", inactive) is None
    zitadel.organisations += [
        {"id": "one", "name": "parfocal-y", "state": ACTIVE},
        {"id": "two", "name": "parfocal-y", "state": ACTIVE},
    ]

    async def ambiguous(directory: ZitadelDirectory) -> str | None:
        return await directory.find_organisation("parfocal-y")

    with pytest.raises(AmbiguousOrganisationError):
        against_fake(zitadel, "admin", ambiguous)


def test_the_directory_treats_a_missing_organisation_as_removed_and_raises_on_errors() -> None:
    zitadel = FakeZitadel()

    async def remove(directory: ZitadelDirectory) -> None:
        await directory.remove_organisation("never-existed")

    against_fake(zitadel, "admin", remove)

    async def broken(directory: ZitadelDirectory) -> None:
        await directory.remove_organisation("broken")

    with pytest.raises(DirectoryError):
        against_fake(zitadel, "admin", broken)

    async def create(directory: ZitadelDirectory) -> str:
        return await directory.ensure_organisation("parfocal-z")

    with pytest.raises(DirectoryError, match="401"):
        against_fake(zitadel, "wrong", create)
    zitadel.create_status = 409
    with pytest.raises(DirectoryError, match="409"):
        against_fake(zitadel, "admin", create)


@pytest.fixture
def zitadel() -> dict[str, str]:
    found = local_zitadel()
    if "ZITADEL_ADMIN_TOKEN" not in found:
        pytest.skip("Run make dev or infra/local/zitadel-up.sh for the local Zitadel")
    if urlparse(found["ZITADEL_ISSUER"]).hostname != "localhost":
        pytest.fail("The command test deletes organisations, so it runs only on a local Zitadel")
    try:
        httpx2.get(f"{found['ZITADEL_ISSUER']}/debug/healthz", timeout=2)
    except httpx2.HTTPError:
        pytest.skip("The local Zitadel in .zitadel/e2e.env is not running")
    return found


@pytest.fixture
def drill() -> Iterator[str]:
    with migrated_database() as name:
        yield name


def settings_for(database: str, zitadel: dict[str, str]) -> ProvisioningSettings:
    return ProvisioningSettings.model_validate(
        {
            "app_env": "test",
            "database_url": with_database(APP_URL, database),
            "master_keys": TEST_MASTER_KEYS,
            "zitadel_issuer": zitadel["ZITADEL_ISSUER"],
            "zitadel_admin_token": zitadel["ZITADEL_ADMIN_TOKEN"],
            "storage_endpoint": TEST_STORAGE.endpoint,
            "storage_region": TEST_STORAGE.region,
            "storage_bucket": TEST_STORAGE.bucket,
            "storage_access_key_id": TEST_STORAGE.access_key_id,
            "storage_secret_access_key": TEST_STORAGE.secret_access_key,
        }
    )


def organisations_named(zitadel: dict[str, str], name: str) -> list[str]:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/v2/organizations/_search",
        json={"queries": [{"nameQuery": {"name": name, "method": "TEXT_QUERY_METHOD_EQUALS"}}]},
        headers={"authorization": f"Bearer {zitadel['ZITADEL_ADMIN_TOKEN']}"},
    )
    response.raise_for_status()
    return [str(o["id"]) for o in response.json().get("result", [])]


def command(
    argv: list[str], settings: ProvisioningSettings, capsys: pytest.CaptureFixture[str]
) -> str:
    main(argv, settings)
    return capsys.readouterr().out.strip()


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_the_command_provisions_and_deprovisions_a_tenant_against_the_local_zitadel(
    drill: str, zitadel: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    settings = settings_for(drill, zitadel)
    slug = f"drill-{uuid.uuid4().hex[:8]}"
    tenant_id = command(
        [
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
        ],
        settings,
        capsys,
    )
    assert uuid.UUID(tenant_id)
    owner = with_database(OWNER_URL, drill)
    assert query(owner, f"SELECT status FROM tenants WHERE id = '{tenant_id}'") == [("active",)]
    assert len(organisations_named(zitadel, f"parfocal-{slug}")) == 1

    removed = command(["deprovision", tenant_id], settings, capsys)
    assert removed == f"{tenant_id} objects_removed=0 keys_shredded=2 idp_organisation_removed=true"
    assert organisations_named(zitadel, f"parfocal-{slug}") == []
    assert query(owner, f"SELECT status FROM tenants WHERE id = '{tenant_id}'") == [("suspended",)]

    again = command(["deprovision", tenant_id], settings, capsys)
    assert again.endswith("keys_shredded=0 idp_organisation_removed=false")

    with pytest.raises(SystemExit) as unknown:
        main(["deprovision", str(uuid.uuid4())], settings)
    assert unknown.value.code == 1
