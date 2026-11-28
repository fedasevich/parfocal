import asyncio
import math
import time
import uuid
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from fixture_support import cache_dir, fixture_path
from test_showcase import OPENABLE, RESULTS, EmptyStore, counts
from test_showcase_outcomes import as_owner

from parfocal_api.model_estimates import estimate_model_run
from parfocal_api.showcase import FIXTURE_PREFIX, FORMAT_GALLERY, VIEWER_SAMPLE_FILE, seed
from parfocal_api.showcase_outcomes import OUTCOME_TASK
from parfocal_api.slide_tissue import read_mask
from parfocal_common.ingest import fixture_original_key, sample_original_key
from parfocal_common.object_store import StorageError
from parfocal_ingest.tissue import CELL
from parfocal_ingest.tissue_seed import COPIED, PRESENT, STORED, store_seeded_masks

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
REQUIRED = "CMU-1-Small-Region.svs"
MODEL = "pathosam-hovernext"


class ServedStore(EmptyStore):
    def __init__(self, originals: dict[str, Path]) -> None:
        super().__init__()
        self.originals = {key: path.resolve() for key, path in originals.items()}
        self.downloads = 0
        self.puts = 0

    async def get_object(self, key: str) -> bytes:
        if key in self.written:
            return self.written[key]
        return await super().get_object(key)

    async def head_object(self, key: str) -> int | None:
        return len(self.written[key]) if key in self.written else None

    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.puts += 1
        self.written[key] = body

    async def download(self, key: str, target: Path) -> None:
        if key not in self.originals:
            raise StorageError(404, "NoSuchKey")
        self.downloads += 1
        await asyncio.to_thread(target.symlink_to, self.originals[key])


def local_originals() -> dict[str, Path]:
    served = {fixture_original_key(REQUIRED): fixture_path(REQUIRED)}
    for name in OPENABLE:
        if (cache_dir() / name).exists():
            served[fixture_original_key(name)] = cache_dir() / name
    for slide in FORMAT_GALLERY:
        if (cache_dir() / slide.file).exists():
            served[f"{FIXTURE_PREFIX}{slide.file}"] = cache_dir() / slide.file
    sample = cache_dir() / VIEWER_SAMPLE_FILE
    if sample.exists():
        served[sample_original_key("test_065", VIEWER_SAMPLE_FILE)] = sample
    return served


@dataclass(frozen=True)
class Seeded:
    url: str
    tenant_ids: list[uuid.UUID]
    store: ServedStore
    first: Counter[str]
    seconds: float


@pytest.fixture(scope="module")
def seeded() -> Iterator[Seeded]:
    store = ServedStore(local_originals())
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        tenant_ids = asyncio.run(seed(url, store, RESULTS, OWNER))  # type: ignore[arg-type]
        started = time.monotonic()
        first = asyncio.run(store_seeded_masks(url, store, tenant_ids))  # type: ignore[arg-type]
        print(f"tissue masks {dict(first)} in {time.monotonic() - started:.1f} s")
        yield Seeded(url, tenant_ids, store, first, time.monotonic() - started)


async def seeded_slides(url: str) -> list[tuple[str, ...]]:
    rows = await run_sql(
        url,
        "SELECT tenant_id::text, id::text, original_key, width::text, height::text FROM slides "
        "WHERE original_key IS NOT NULL AND file_bytes IS NOT NULL AND deleted_at IS NULL",
    )
    return [tuple(str(value) for value in row) for row in rows]


def mask_key(tenant_id: str, slide_id: str) -> str:
    return f"t/{tenant_id}/s/{slide_id}/tissue.png"


async def test_every_seeded_slide_with_a_readable_original_has_a_stored_tissue_mask(
    seeded: Seeded,
) -> None:
    slides = await seeded_slides(seeded.url)
    served = [row for row in slides if row[2] in seeded.store.originals]
    assert served
    assert seeded.first[STORED] == len(served)
    assert set(seeded.first) <= {STORED, "missing"}
    for tenant_id, slide_id, original_key, width, height in served:
        mask = read_mask(seeded.store.written[mask_key(tenant_id, slide_id)])
        assert seeded.store.written[f"t/{tenant_id}/s/{slide_id}/tissue.json"]
        if original_key == fixture_original_key(REQUIRED):
            grid = (math.ceil(int(width) / CELL), math.ceil(int(height) / CELL))
            assert (mask.width, mask.height) == grid
        assert any(value for row in mask.cells for value in row)
    assert seeded.store.downloads == len({row[2] for row in served})


async def test_a_seeded_slide_gets_a_projected_time_and_cost(seeded: Seeded) -> None:
    async for _, principal, connection in as_owner(seeded.url, OUTCOME_TASK):
        rows = await run_sql(
            seeded.url,
            "SELECT id, project_id FROM slides WHERE mpp_x IS NOT NULL "
            f"AND original_key = '{fixture_original_key(REQUIRED)}' "
            f"AND tenant_id = '{principal.tenant_id}' LIMIT 1",
        )
        slide_id, project_id = (uuid.UUID(str(value)) for value in rows[0])
        found = await estimate_model_run(
            project_id,
            MODEL,
            [slide_id],
            principal,
            connection,
            seeded.store,  # type: ignore[arg-type]
        )
        assert len(found) == 1
        estimate = found[0]
        assert estimate.projected is True
        assert (estimate.tissue_mm2 or 0) > 0
        assert (estimate.minutes or 0) >= 1
        assert (estimate.dollars or 0) > 0
        assert estimate.unknown_because is None


async def test_a_second_seed_stores_no_mask_again_and_leaves_the_same_rows(
    seeded: Seeded,
) -> None:
    before = await counts(seeded.url)
    puts, downloads = seeded.store.puts, seeded.store.downloads
    tenant_ids = await seed(seeded.url, seeded.store, RESULTS, OWNER)  # type: ignore[arg-type]
    puts_after_seed = seeded.store.puts
    again = await store_seeded_masks(seeded.url, seeded.store, tenant_ids)  # type: ignore[arg-type]
    assert tenant_ids == seeded.tenant_ids
    assert set(again) == {PRESENT, "missing"} or set(again) == {PRESENT}
    assert again[PRESENT] == seeded.first[STORED]
    assert seeded.store.puts == puts_after_seed
    assert seeded.store.downloads == downloads
    assert puts_after_seed >= puts
    assert await counts(seeded.url) == before


async def test_a_slide_seeded_after_a_reset_copies_the_mask_kept_beside_its_original(
    seeded: Seeded,
) -> None:
    key = fixture_original_key(REQUIRED)
    kept = [name for name in seeded.store.written if name.startswith(key.rsplit("/", 1)[0])]
    assert {name.rsplit("/", 1)[1] for name in kept} >= {"tissue.png", "tissue.json"}
    for name in [name for name in seeded.store.written if name.startswith("t/")]:
        if name.endswith(("tissue.png", "tissue.json")):
            del seeded.store.written[name]
    downloads = seeded.store.downloads
    started = time.monotonic()
    copied = await store_seeded_masks(seeded.url, seeded.store, seeded.tenant_ids)  # type: ignore[arg-type]
    print(f"tissue masks after a reset {dict(copied)} in {time.monotonic() - started:.1f} s")
    assert copied[COPIED] > 0
    beside = {
        original for original in seeded.store.originals if not original.startswith(FIXTURE_PREFIX)
    }
    assert seeded.store.downloads - downloads == len(
        {row[2] for row in await seeded_slides(seeded.url) if row[2] in seeded.store.originals}
        - beside
    )
