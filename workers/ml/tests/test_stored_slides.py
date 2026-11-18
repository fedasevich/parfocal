import asyncio
import json
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import numpy as np
import pytest
from fixture_support import fixture_path
from numpy.typing import NDArray
from test_tumor_map_job import MemoryProgress
from tumor_map_support import STORED_SLIDE, CentreScorer, levels_json

from parfocal_common.ingest import original_key, slide_prefix
from parfocal_common.jobs import JobStoppedError, StepFailedError
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_imports import HEATMAP_FACTS, HEATMAP_GRID
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.tumor_maps import tiles_prefix
from parfocal_ml.stored_slides import LEVELS_NAME, MISSING, UNREADABLE, StoredSlides
from parfocal_ml.tumor_map import CELL, TILE_SIDE, Scorer, grid_shape, store_tumor_map, unpacked
from parfocal_ml.tumor_map_job import assembled, score_tiles
from parfocal_ml.tumor_map_worker import OnnxTumorScorer, local_weights

openslide = pytest.importorskip("openslide")

SLIDE = STORED_SLIDE
JOB = uuid.UUID(int=7)
LOCAL_STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)

type Work[T] = Callable[[ObjectStore, StoredSlides, uuid.UUID, uuid.UUID], Awaitable[T]]


async def stored(
    storage: ObjectStore, tenant: uuid.UUID, slide: uuid.UUID, name: str, levels: bytes | None
) -> None:
    path = fixture_path(SLIDE)
    table = levels_json(path) if levels is None else levels
    key = original_key(tenant, slide, name)
    await storage.put_object(key, path.read_bytes(), "application/octet-stream")
    if table:
        prefix = slide_prefix(tenant, slide)
        await storage.put_object(f"{prefix}{LEVELS_NAME}", table, "application/json")


def in_minio[T](
    work: Work[T], tmp_path: Path, name: str | None = SLIDE, levels: bytes | None = None
) -> T:
    async def go() -> T:
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            storage = ObjectStore(LOCAL_STORAGE, http)
            try:
                await storage.create_bucket()
            except httpx2.TransportError:
                pytest.skip(f"MinIO is not running at {LOCAL_STORAGE.endpoint}")
            tenant, slide = uuid.uuid4(), uuid.uuid4()
            slides = StoredSlides(storage, tmp_path)
            try:
                if name is not None:
                    await stored(storage, tenant, slide, name, levels)
                return await work(storage, slides, tenant, slide)
            finally:
                slides.close()
                for key in await storage.list_keys(f"t/{tenant}/"):
                    await storage.delete_object(key)

    return asyncio.run(go())


def local_region(x: int, y: int, width: int, height: int) -> np.ndarray:
    slide = openslide.OpenSlide(str(fixture_path(SLIDE)))
    rgba = np.asarray(slide.read_region((x, y), 0, (width, height)))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    return rgb


@dataclass(frozen=True)
class Mapped:
    facts: dict[str, Any]
    grid: NDArray[np.uint8]
    tissue: NDArray[np.bool_]


async def mapped(
    storage: ObjectStore,
    slides: StoredSlides,
    tenant: uuid.UUID,
    slide_id: uuid.UUID,
    scorer: Scorer,
    progress: MemoryProgress,
    job: uuid.UUID = JOB,
) -> Mapped:
    slide = await slides.open(tenant, slide_id)
    store = ObjectResultStore(storage)
    tiles = tiles_prefix(tenant, slide_id, job)
    result = f"{slide_prefix(tenant, slide_id)}results/{job}/"
    await score_tiles(slide, scorer, store, tiles, progress)
    tumor_map = await assembled(await slides.open(tenant, slide_id), store, tiles)
    await store_tumor_map(store, tumor_map, result, slide.mpp, slide.level_count)
    facts = json.loads(await storage.get_object(f"{result}{HEATMAP_FACTS}"))
    rows, columns = grid_shape(slide.width, slide.height)
    grid = unpacked(await storage.get_stored_bytes(f"{result}{HEATMAP_GRID}"), columns, rows)
    return Mapped(facts, grid, tumor_map.tissue)


def test_the_opener_reads_level_0_regions_of_the_stored_slide(tmp_path: Path):
    async def work(storage, slides, tenant, slide_id):
        slide = await slides.open(tenant, slide_id)
        again = await slides.open(tenant, slide_id)
        edge = slide.reader.read(-96, 1200, 200, 100)
        return slide, again, edge, slide.reader.read(1000, 1200, 600, 400)

    slide, again, edge, region = in_minio(work, tmp_path)
    assert again is slide
    assert (slide.width, slide.height, slide.level_count) == (2220, 2967, 1)
    assert slide.mpp == pytest.approx(0.499)
    assert slide.thumbnail.shape == (47, 35, 3)
    assert slide.downsample == 64.0
    np.testing.assert_array_equal(edge, local_region(-96, 1200, 200, 100))
    np.testing.assert_array_equal(region, local_region(1000, 1200, 600, 400))
    assert set(np.unique(edge[:, :96])) == {255}
    assert region.std() > 10
    assert not any(tmp_path.rglob("*.svs"))


def test_the_job_maps_a_stored_slide_through_the_real_opener_and_resumes(tmp_path: Path):
    async def work(storage, slides, tenant, slide_id):
        progress = MemoryProgress(stop_after=1)
        with pytest.raises(JobStoppedError):
            await mapped(storage, slides, tenant, slide_id, CentreScorer(), progress)
        first = list(progress.marked)
        progress.stop_after = None
        return (
            first,
            progress,
            await mapped(storage, slides, tenant, slide_id, CentreScorer(), progress),
        )

    first, progress, result = in_minio(work, tmp_path)
    assert first == [0]
    assert progress.marked == list(range(progress.counted))
    facts, grid, tissue = result.facts, result.grid, result.tissue
    assert (facts["width"], facts["height"], facts["downsample"]) == (35, 47, float(CELL))
    assert facts["level"] is None
    assert facts["mpp"] == pytest.approx(0.499 * CELL, rel=1e-3)
    assert grid.shape == (47, 35)
    assert 0.2 < tissue.mean() < 0.95
    assert grid[~tissue].max() == 0
    assert grid[tissue].max() > 0


def test_a_slide_kept_in_a_shared_folder_opens_from_that_folder(tmp_path: Path):
    async def work(storage, slides, tenant, slide_id):
        folder = f"t/{tenant}/shared/{slide_id}/"
        for key in await storage.list_keys(slide_prefix(tenant, slide_id)):
            name = key.removeprefix(slide_prefix(tenant, slide_id))
            await storage.put_object(
                f"{folder}{name}", await storage.get_object(key), "application/octet-stream"
            )
            await storage.delete_object(key)
        with pytest.raises(StepFailedError):
            await slides.open(tenant, slide_id)
        return await slides.open(tenant, slide_id, folder)

    assert in_minio(work, tmp_path).width == 2220


def test_a_slide_without_an_original_fails_as_missing(tmp_path: Path):
    async def work(storage, slides, tenant, slide_id):
        with pytest.raises(StepFailedError) as raised:
            await slides.open(tenant, slide_id)
        return raised.value.code

    assert in_minio(work, tmp_path, name=None) == MISSING


def test_an_original_openslide_cannot_read_alone_fails_as_unreadable(tmp_path: Path):
    async def work(storage, slides, tenant, slide_id):
        with pytest.raises(StepFailedError) as raised:
            await slides.open(tenant, slide_id)
        return raised.value.code

    assert in_minio(work, tmp_path, name="slide.zip") == UNREADABLE


def refused(tmp_path: Path, levels: bytes) -> str:
    async def work(storage, slides, tenant, slide_id):
        with pytest.raises(StepFailedError) as raised:
            await slides.open(tenant, slide_id)
        return raised.value.code

    return in_minio(work, tmp_path, levels=levels)


def test_a_slide_without_a_level_table_fails_as_missing(tmp_path: Path):
    assert refused(tmp_path, b"") == MISSING


def test_a_level_table_that_disagrees_with_openslide_fails_and_leaves_no_download(
    tmp_path: Path,
):
    table = json.dumps({"levels": [{"width": 2000, "height": 2967}], "scale": {}}).encode()
    assert refused(tmp_path, table) == UNREADABLE
    assert not any(path.is_file() for path in tmp_path.rglob("*"))


@pytest.mark.weights
def test_the_resnet18_maps_the_stored_slide_as_torch_scores_it(tmp_path: Path):
    weights = local_weights()
    if weights is None:
        pytest.skip(
            "camelyon-tumor.onnx is not exported, run workers/ml/spike/export_tumor_onnx.py"
        )
    pytest.importorskip("onnxruntime")
    scorer = OnnxTumorScorer(weights)
    torch_scores = np.load(weights.with_suffix(".torch.npy"))

    async def work(storage, slides, tenant, slide_id):
        slide = await slides.open(tenant, slide_id)
        first = scorer.score(slide.reader.read(0, 0, TILE_SIDE, TILE_SIDE))
        return first, await mapped(storage, slides, tenant, slide_id, scorer, MemoryProgress())

    first, result = in_minio(work, tmp_path)
    assert first.shape == (64, 64)
    np.testing.assert_allclose(first, torch_scores, atol=1e-5)
    grid, tissue = result.grid, result.tissue
    assert grid.shape == (47, 35)
    assert grid[~tissue].max() == 0
    assert 0 <= grid.min() <= grid.max() <= 255
