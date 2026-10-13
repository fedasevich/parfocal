from collections.abc import Iterator

import pytest
from db_support import ApiAs, api_as, migrated_database


@pytest.fixture(scope="session")
def database() -> Iterator[str]:
    with migrated_database() as name:
        yield name


@pytest.fixture
def api(database: str) -> Iterator[ApiAs]:
    with api_as(database) as acting:
        yield acting
