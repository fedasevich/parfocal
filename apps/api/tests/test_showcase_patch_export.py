import asyncio
import io
import json
import shutil
import uuid
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from fixture_support import cache_dir, fixture_path
from test_showcase import OPENABLE, RESULTS, EmptyStore
from test_showcase_outcomes import as_owner

from parfocal_api.patch_exports import download_patch_export, list_patch_exports
from parfocal_api.showcase import seed
from parfocal_api.showcase_outcomes import OUTCOME_TASK
from parfocal_common.ingest import fixture_original_key
from parfocal_common.object_store import StorageError
from parfocal_ingest.showcase_seed import cut_seeded_exports

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
REQUIRED = "CMU-1-Small-Region.svs"


class ServedStore(EmptyStore):
    def __init__(self, originals: dict[str, Path]) -> None:
        super().__init__()
        self.originals = originals

    async def get_object(self, key: str) -> bytes:
        if key in self.written:
            return self.written[key]
        return await super().get_object(key)

    async def head_object(self, key: str) -> int | None:
        return len(self.written[key]) if key in self.written else None

    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.written[key] = body

    async def download(self, key: str, target: Path) -> None:
        if key not in self.originals:
            raise StorageError(404, "NoSuchKey")
        shutil.copyfile(self.originals[key], target)


def local_originals() -> dict[str, Path]:
    served = {fixture_original_key(REQUIRED): fixture_path(REQUIRED)}
    for name in OPENABLE:
        if (cache_dir() / name).exists():
            served[fixture_original_key(name)] = cache_dir() / name
    return served


@pytest.fixture(scope="module")
def exported() -> Iterator[tuple[str, list[int], ServedStore]]:
    store = ServedStore(local_originals())
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        asyncio.run(seed(url, store, RESULTS, OWNER))  # type: ignore[arg-type]
        counts = asyncio.run(cut_seeded_exports(url, store))  # type: ignore[arg-type]
        yield url, counts, store


async def test_the_seeded_coco_export_downloads_a_zip_with_annotations(
    exported: tuple[str, list[int], ServedStore],
) -> None:
    url, counts, store = exported
    assert counts
    assert all(count >= 1 for count in counts)
    async for task_id, principal, connection in as_owner(url, OUTCOME_TASK):
        found = await run_sql(url, f"SELECT id FROM jobs WHERE input->>'task_id' = '{task_id}'")
        job_id = found[0][0]
        response = await download_patch_export(
            task_id,
            uuid.UUID(str(job_id)),
            principal,
            connection,
            store,  # type: ignore[arg-type]
        )
        with zipfile.ZipFile(io.BytesIO(bytes(response.body))) as archive:
            coco = json.loads(archive.read("annotations.json"))
            manifest = json.loads(archive.read("manifest.json"))
            names = set(archive.namelist())
        assert response.media_type == "application/zip"
        assert coco["info"]["dataset_version"] == 1
        assert manifest["dataset_version"] == 1
        assert len(coco["annotations"]) >= 1
        assert {image["file_name"] for image in coco["images"]} <= names


async def test_the_seeded_export_is_listed_for_a_colleague(
    exported: tuple[str, list[int], ServedStore],
) -> None:
    url, _, store = exported
    async for task_id, principal, connection in as_owner(url, OUTCOME_TASK):
        entries = await list_patch_exports(
            task_id,
            principal,
            connection,
            store,  # type: ignore[arg-type]
        )
        assert len(entries) == 1
        entry = entries[0]
        assert entry.state.value == "done"
        assert entry.format == "coco"
        assert entry.dataset_version == 1
        assert entry.started_by
        assert entry.bytes is not None
        assert entry.bytes > 0
        assert entry.finished_at is not None
