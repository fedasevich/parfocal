import asyncio
import os
import uuid

import httpx2
import pytest

from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.fixture_slides import SYNTHETIC_FOLDER
from parfocal_ingest.thumbnail_backfill import (
    COPIED,
    PRESENT,
    SKIPPED,
    STORED,
    ensure_thumbnail,
)

STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-thumbnail-backfill-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
SLIDE = "synthetic-jpeg.tiff"
TENANT = uuid.uuid4()


async def run() -> list[str]:
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(STORAGE, http)
        await store.create_bucket()
        for key in await store.list_keys(""):
            await store.delete_object(key)
        await store.put_object(
            f"fixtures/{SLIDE}", (SYNTHETIC_FOLDER / SLIDE).read_bytes(), "image/tiff"
        )
        made: dict[str, bytes] = {}
        states = []
        slides = [uuid.uuid4() for _ in range(3)]
        for slide in slides[:2]:
            states.append(await ensure_thumbnail(store, TENANT, slide, f"fixtures/{SLIDE}", made))
        states.append(await ensure_thumbnail(store, TENANT, slides[0], f"fixtures/{SLIDE}", made))
        states.append(await ensure_thumbnail(store, TENANT, slides[2], f"t/{TENANT}/s/x/o.tif", {}))
        for slide in slides[:2]:
            body = await store.get_object(f"{slide_prefix(TENANT, slide)}thumbnail.jpg")
            assert body[:3] == b"\xff\xd8\xff"
        return states


@pytest.mark.db
def test_a_slide_without_a_thumbnail_gets_one_and_a_second_run_changes_nothing() -> None:
    assert asyncio.run(run()) == [STORED, COPIED, PRESENT, SKIPPED]
