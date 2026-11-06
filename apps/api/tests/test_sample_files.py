import hashlib
import json
import os
import shutil
from pathlib import Path

import pytest
from fixture_support import fixture_path
from storage_support import MIB, with_store

from parfocal_api.sample_files import SampleFile, stored_sample_file
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest import sample_files
from parfocal_ingest.sample_files import send_original, send_samples

pytestmark = pytest.mark.db


def test_the_loader_stores_each_sample_once_with_its_size_and_checksum(
    storage: StorageLocation, tmp_path: Path
) -> None:
    assert storage.bucket
    source = fixture_path("synthetic-jpeg.tiff")
    shutil.copy(source, tmp_path / "tumor_001.tif")
    (tmp_path / "notes.txt").write_text("not a slide")
    data = source.read_bytes()

    async def go(store: ObjectStore) -> tuple[dict[str, SampleFile], SampleFile | None, bytes]:
        sent = await send_samples(store, tmp_path)
        found = await stored_sample_file(store, "tumor_001")
        levels = await store.get_object("samples/camelyon16/tumor_001/levels.json")
        assert await store.get_object(sent["tumor_001"].original_key) == data
        assert await store.head_object("samples/camelyon16/tumor_001/thumbnail.jpg")
        ranges = await store.get_object("samples/camelyon16/tumor_001/restricted-ranges.json")
        assert json.loads(ranges) == {"ranges": []}
        return sent, found, levels

    sent, found, levels = with_store(go)
    assert list(sent) == ["tumor_001"]
    facts = sent["tumor_001"]
    assert found == facts
    assert (facts.original_key, facts.file_bytes, facts.sha256, facts.format) == (
        "samples/camelyon16/tumor_001/original.tif",
        len(data),
        hashlib.sha256(data).hexdigest(),
        "generic-tiff",
    )
    assert facts.level_count == len(json.loads(levels)["levels"])


def test_a_large_original_goes_up_in_parts_without_being_read_whole(
    storage: StorageLocation, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert storage.bucket
    monkeypatch.setattr(sample_files, "PART_BYTES", 5 * MIB)
    data = os.urandom(6 * MIB)
    path = tmp_path / "big.tif"
    path.write_bytes(data)
    key = "samples/camelyon16/loader-test/original.tif"

    async def go(store: ObjectStore) -> tuple[tuple[int, str], bytes]:
        sent = await send_original(store, path, key)
        stored = await store.get_object(key)
        await store.delete_object(key)
        return sent, stored

    sent, stored = with_store(go)
    assert sent == (len(data), hashlib.sha256(data).hexdigest())
    assert stored == data
