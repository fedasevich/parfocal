import os
import secrets

import httpx2
import pytest

from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_deploy.object_recovery import (
    NoPreviousVersionError,
    enable_versioning,
    restore_previous,
    versions,
)

pytestmark = pytest.mark.db

KEY = "t/one/slides/two/original.svs"


def location() -> StorageLocation:
    return StorageLocation(
        endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
        region="auto",
        bucket=f"parfocal-recovery-{secrets.token_hex(4)}",
        access_key_id="parfocal",
        secret_access_key="parfocal-local-secret",
    )


async def versioned_store(http: httpx2.AsyncClient) -> ObjectStore:
    store = ObjectStore(location(), http)
    await store.create_bucket()
    await enable_versioning(store)
    return store


async def remove(store: ObjectStore) -> None:
    for version in await versions(store, KEY):
        await store.send("DELETE", KEY, {"versionId": version.version_id})
    await store.send("DELETE", "")


async def test_a_deleted_object_comes_back_from_its_previous_version() -> None:
    async with httpx2.AsyncClient(timeout=30) as http:
        store = await versioned_store(http)
        await store.put_object(KEY, b"first scan", "image/tiff")
        await store.delete_object(KEY)
        assert await store.head_object(KEY) is None

        await restore_previous(store, KEY)

        assert await store.get_object(KEY) == b"first scan"
        await remove(store)


async def test_an_overwritten_object_gets_its_earlier_bytes_back() -> None:
    async with httpx2.AsyncClient(timeout=30) as http:
        store = await versioned_store(http)
        await store.put_object(KEY, b"first scan", "image/tiff")
        await store.put_object(KEY, b"wrong upload", "image/tiff")

        await restore_previous(store, KEY)

        assert await store.get_object(KEY) == b"first scan"
        await remove(store)


async def test_an_object_with_one_version_has_nothing_to_restore() -> None:
    async with httpx2.AsyncClient(timeout=30) as http:
        store = await versioned_store(http)
        await store.put_object(KEY, b"only scan", "image/tiff")

        with pytest.raises(NoPreviousVersionError):
            await restore_previous(store, KEY)
        await remove(store)
