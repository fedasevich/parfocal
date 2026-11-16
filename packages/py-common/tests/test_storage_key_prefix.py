import asyncio
from datetime import UTC, datetime

import httpx2
import pytest
from pydantic import AnyHttpUrl, SecretStr, ValidationError

from parfocal_common.object_store import ObjectStore, StorageLocation, presign
from parfocal_common.settings import AppEnv, StorageSettings

PREVIEW = StorageLocation(
    "http://127.0.0.1:9000", "auto", "bucket", "id", "secret", key_prefix="previews/pr-7/"
)
LISTING = b"""<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<IsTruncated>false</IsTruncated>
<Contents><Key>previews/pr-7/t/a/s/b/original.svs</Key></Contents>
</ListBucketResult>"""


def test_a_preview_writes_tenant_keys_under_its_prefix_and_reads_fixtures_where_they_are() -> None:
    when = datetime(2026, 11, 16, tzinfo=UTC)
    tenant = presign(PREVIEW, "PUT", "t/a/quarantine/u/x.svs", {}, 900, when)
    fixture = presign(PREVIEW, "GET", "fixtures/CMU-1.svs", {}, 900, when)
    assert tenant.startswith("http://127.0.0.1:9000/bucket/previews/pr-7/t/a/quarantine/u/x.svs?")
    assert fixture.startswith("http://127.0.0.1:9000/bucket/fixtures/CMU-1.svs?")


def test_a_preview_lists_its_own_tenant_keys_and_sees_them_without_the_prefix() -> None:
    asked: list[str] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        asked.append(request.url.params["prefix"])
        return httpx2.Response(200, content=LISTING)

    async def listed() -> list[str]:
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(answer)) as http:
            return await ObjectStore(PREVIEW, http).list_keys("t/a/")

    assert asyncio.run(listed()) == ["t/a/s/b/original.svs"]
    assert asked == ["previews/pr-7/t/a/"]


@pytest.mark.parametrize("prefix", ["fixtures/", "previews/", "previews/pr-7", "t/", "../"])
def test_only_a_preview_prefix_is_accepted(prefix: str) -> None:
    with pytest.raises(ValidationError, match="STORAGE_KEY_PREFIX"):
        StorageSettings(app_env=AppEnv.PREVIEW, storage_key_prefix=prefix)


def test_production_never_takes_a_key_prefix() -> None:
    with pytest.raises(ValidationError, match="STORAGE_KEY_PREFIX"):
        StorageSettings(
            app_env=AppEnv.PROD,
            storage_key_prefix="previews/pr-7/",
            storage_endpoint=AnyHttpUrl("https://account.r2.cloudflarestorage.com"),
            storage_secret_access_key=SecretStr("not-local"),
        )
    location = StorageSettings(
        app_env=AppEnv.PREVIEW, storage_key_prefix="previews/pr-7/"
    ).storage()
    assert location.key_prefix == "previews/pr-7/"
