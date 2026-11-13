import asyncio
import os

import httpx2
import pytest

from parfocal_api.showcase import FORMAT_GALLERY
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_deploy.reset import KEPT_TABLES, empty_tenant_objects, metadata, truncate_statement
from parfocal_ingest.identify import Format

RESET_STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-reset-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
KEPT_KEYS = (
    "fixtures/CMU-1-Small-Region.svs",
    "fixtures/manifest.json",
    "samples/camelyon16/tumor/tumor_001.tif",
    "tenants/t/not-a-tenant.txt",
)
TENANT_KEYS = ("t/one/slides/two/original.svs", "t/three/results/four.geojson")
UNSEEDED_FORMATS = {Format.OME_TIFF}


async def stored_keys_after_reset() -> tuple[int, list[str]]:
    async with httpx2.AsyncClient(timeout=30) as http:
        store = ObjectStore(RESET_STORAGE, http)
        await store.create_bucket()
        for key in await store.list_keys(""):
            await store.delete_object(key)
        for key in KEPT_KEYS + TENANT_KEYS:
            await store.put_object(key, b"x", "application/octet-stream")
        removed = await empty_tenant_objects(RESET_STORAGE)
        return removed, sorted(await store.list_keys(""))


@pytest.mark.db
def test_the_reset_removes_tenant_objects_and_leaves_fixtures_untouched() -> None:
    removed, left = asyncio.run(stored_keys_after_reset())
    assert removed == len(TENANT_KEYS)
    assert left == sorted(KEPT_KEYS)


def test_the_truncate_keeps_migrations_and_operators() -> None:
    statement = truncate_statement()
    truncated = set(statement.removeprefix("TRUNCATE ").split(" RESTART")[0].split(", "))
    assert truncated == {table.name for table in metadata.sorted_tables} - KEPT_TABLES
    assert "slides" in truncated


def test_the_gallery_covers_every_ingest_format_but_the_unseeded() -> None:
    assert set(Format) - UNSEEDED_FORMATS <= {slide.format for slide in FORMAT_GALLERY}
