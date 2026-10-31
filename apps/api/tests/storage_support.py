import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import httpx2

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
