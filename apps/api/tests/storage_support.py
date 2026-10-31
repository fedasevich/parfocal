import asyncio
import os
import uuid
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime

import httpx2

from parfocal_common.ingest import RESTRICTED_FILES, RestrictedImage, restricted_key
from parfocal_common.object_store import ObjectStore, StorageLocation, presign

MIB = 1024 * 1024
TEST_PART_BYTES = 5 * MIB
TEST_MAX_BYTES = 64 * MIB
TEST_PAGE_SIZE = 2
TEST_STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)


def with_store[T](work: Callable[[ObjectStore], Awaitable[T]]) -> T:
    async def go() -> T:
        async with httpx2.AsyncClient(timeout=30) as http:
            return await work(ObjectStore(TEST_STORAGE, http))

    return asyncio.run(go())


def ensure_bucket() -> None:
    with_store(lambda store: store.create_bucket())


def put(url: str, data: bytes) -> httpx2.Response:
    return httpx2.put(url, content=data, headers={"content-type": "application/octet-stream"})


def read_object(key: str) -> bytes:
    url = presign(TEST_STORAGE, "GET", key, {}, 60, datetime.now(UTC))
    response = httpx2.get(url)
    response.raise_for_status()
    return response.content


def stand_in_images(marker: str) -> dict[RestrictedImage, bytes]:
    return {
        RestrictedImage.LABEL: b"\x89PNG\r\n\x1a\n" + f"label of {marker}".encode(),
        RestrictedImage.MACRO: b"\xff\xd8\xff" + f"macro of {marker}".encode(),
    }


async def put_restricted_images(
    store: ObjectStore,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    images: Mapping[RestrictedImage, bytes],
) -> None:
    for image, body in images.items():
        key = restricted_key(tenant_id, slide_id, image)
        await store.put_object(key, body, RESTRICTED_FILES[image][1])


def stored_keys(prefix: str) -> list[str]:
    return with_store(lambda store: store.list_keys(prefix))
