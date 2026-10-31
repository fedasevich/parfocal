from collections.abc import Iterator

import pytest
from db_support import ApiAs, api_as, migrated_database
from idp_support import Browser, signed_in_browser
from storage_support import TEST_STORAGE, ensure_bucket

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
