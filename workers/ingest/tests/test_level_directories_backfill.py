import asyncio
import gzip
import json
import os
import uuid

import httpx2
import pytest

from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.fixture_slides import SYNTHETIC_FOLDER
from parfocal_ingest.level_directories_backfill import (
    PRESENT,
    SKIPPED,
    STORED,
    StoredSlide,
    locate_levels,
    stored_slide,
)
from parfocal_ingest.parse_jobs import identify_file, level_table
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.tile_index import index_document, tile_index

STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-level-directories-backfill-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
SLIDE = "synthetic-channels-uint8.ome.tiff"
TENANT = uuid.uuid4()


def without_open_facts(table: bytes) -> bytes:
    document = json.loads(table)
    del document["littleEndian"], document["bigTiff"]
    for level in document["levels"]:
        for entry in [level, *level["siblings"]]:
            del entry["valueRanges"]
    return json.dumps(document).encode()


def derived() -> tuple[bytes, bytes, bytes]:
    path = SYNTHETIC_FOLDER / SLIDE
    identified = identify_file(path, SLIDE)
    found = read_pyramid(path, identified)
    assert isinstance(found, Pyramid)
    tiles = tile_index(path, identified, found)
    assert tiles is not None
    packed = gzip.compress(index_document(tiles), mtime=0)
    return level_table(found), packed, level_table(found, path, tiles)


async def run() -> tuple[list[str], dict, dict, dict, bytes]:
    plain, packed, expected = derived()
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(STORAGE, http)
        await store.create_bucket()
        for key in await store.list_keys(""):
            await store.delete_object(key)
        uploaded = StoredSlide("t/a/s/1/", f"t/a/s/1/{SLIDE}")
        remote = StoredSlide("t/a/s/2/", None)
        bare = StoredSlide("t/a/s/3/", f"t/a/s/3/{SLIDE}")
        earlier = StoredSlide("t/a/s/4/", f"t/a/s/4/{SLIDE}")
        for slide in (uploaded, remote, bare):
            await store.put_object(f"{slide.folder}levels.json", plain, "application/json")
        await store.put_object(
            f"{earlier.folder}levels.json", without_open_facts(expected), "application/json"
        )
        for slide in (uploaded, remote, earlier):
            await store.put_object(
                f"{slide.folder}tile-index.json",
                packed,
                "application/json",
                content_encoding="gzip",
            )
        for slide in (uploaded, earlier):
            await store.put_object(
                slide.original_key or "", (SYNTHETIC_FOLDER / SLIDE).read_bytes(), "image/tiff"
            )
        order = (uploaded, uploaded, remote, bare, earlier, earlier)
        states = [await locate_levels(store, slide) for slide in order]
        written = json.loads(await store.get_object(f"{uploaded.folder}levels.json"))
        remote_table = json.loads(await store.get_object(f"{remote.folder}levels.json"))
        rewritten = json.loads(await store.get_object(f"{earlier.folder}levels.json"))
        return states, written, remote_table, rewritten, expected


@pytest.mark.db
def test_a_stored_table_gains_what_ingest_writes_and_keeps_it() -> None:
    states, written, remote_table, rewritten, expected = asyncio.run(run())
    assert states == [STORED, PRESENT, STORED, SKIPPED, STORED, PRESENT]
    assert written == json.loads(expected)
    assert rewritten == json.loads(expected)
    assert remote_table["bigTiff"] is False
    assert all("ifdOffset" in level for level in remote_table["levels"])
    assert all("ifdBytes" not in level for level in remote_table["levels"])


def test_a_remote_slide_keeps_its_table_beside_the_slide() -> None:
    tenant, slide = uuid.uuid4(), uuid.uuid4()
    remote = stored_slide(tenant, slide, "remote", None)
    assert remote == StoredSlide(f"t/{tenant}/s/{slide}/", None)
    assert stored_slide(tenant, slide, "uploaded", None) is None
    assert stored_slide(tenant, slide, "uploaded", "fixtures/a.svs") == StoredSlide(
        "fixtures/", "fixtures/a.svs"
    )
