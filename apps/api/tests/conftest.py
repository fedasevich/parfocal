from collections.abc import Iterator
from urllib.parse import urlparse

import httpx2
import pytest
from db_support import ApiAs, api_as, migrated_database
from idp_support import Browser, signed_in_browser
from storage_support import TEST_STORAGE, ensure_bucket
from upload_support import Lab, make_lab
from zitadel_support import local_zitadel

from parfocal_common.object_store import StorageLocation


@pytest.fixture(scope="session")
def database() -> Iterator[str]:
    with migrated_database() as name:
        yield name


@pytest.fixture(scope="session")
def storage() -> StorageLocation:
    ensure_bucket()
    return TEST_STORAGE


@pytest.fixture
def api(database: str) -> Iterator[ApiAs]:
    with api_as(database) as acting:
        yield acting


@pytest.fixture
def browser(database: str) -> Iterator[Browser]:
    with signed_in_browser(database) as signed_in:
        yield signed_in


@pytest.fixture
def lab(database: str) -> Lab:
    return make_lab(database)


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
