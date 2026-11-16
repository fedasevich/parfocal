import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from parfocal_common.gpu_usage import report_gpu_seconds
from parfocal_common.jobs import JobStoppedError, StepFailedError, StepRun, Workflow
from parfocal_common.model_runs import SEAL_RESULT
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ResultStore
from parfocal_common.tumor_maps import (
    MAX_TILES,
    SCORED,
    STORED,
    claimed_input,
    tile_key,
    tiles_prefix,
    workflow,
)
from parfocal_ml.gpu_pool import Family
from parfocal_ml.tumor_map import (
    CELL,
    Mask,
    RegionReader,
    Rgb,
    Scorer,
    TumorMap,
    decoded,
    packed,
    planned_tiles,
    score_tile,
    store_tumor_map,
    stored_values,
    tile_cells,
    tissue_cells,
    unpacked,
)

POOL_FAMILY = Family.DETECTOR_GOOD
TOO_LARGE = "tumor-map-too-large"


@dataclass(frozen=True)
class SlideImage:
    reader: RegionReader
    thumbnail: Rgb
    downsample: float
    width: int
    height: int
    mpp: float | None
    level_count: int | None = None

    def tissue(self) -> Mask:
        return tissue_cells(self.thumbnail, self.downsample, self.width, self.height)


type SlideOpener = Callable[[uuid.UUID, uuid.UUID], Awaitable[SlideImage]]


class Progress(Protocol):
    async def done(self) -> frozenset[int]: ...

    async def total(self, count: int) -> None: ...

    async def mark(self, index: int) -> None: ...

    async def should_stop(self) -> bool: ...


@dataclass(frozen=True)
class StepProgress:
    step: StepRun

    async def done(self) -> frozenset[int]:
        return await self.step.done_units()

    async def total(self, count: int) -> None:
        await self.step.set_total(count)

    async def mark(self, index: int) -> None:
        async with self.step.transaction() as connection:
            await self.step.mark_unit(connection, index)

    async def should_stop(self) -> bool:
        return await self.step.should_stop()


async def score_tiles(
    slide: SlideImage,
    scorer: Scorer,
    store: ResultStore,
    prefix: str,
    progress: Progress,
    max_tiles: int = MAX_TILES,
) -> int:
    tissue = slide.tissue()
    tiles = planned_tiles(tissue)
    if len(tiles) > max_tiles:
        raise StepFailedError(TOO_LARGE)
    await progress.total(len(tiles))
    done = await progress.done()
    ran = 0
    for index, (left, top) in enumerate(tiles):
        if index in done:
            continue
        if await progress.should_stop():
            raise JobStoppedError
        cells = score_tile(slide.reader, scorer, tissue, left, top)
        on = tissue[tile_cells(tissue, left, top)]
        await store.put(tile_key(prefix, index), packed(stored_values(cells, on)))
        await progress.mark(index)
        ran += 1
    return ran


async def assembled(slide: SlideImage, store: ResultStore, prefix: str) -> TumorMap:
    tissue = slide.tissue()
    tiles = planned_tiles(tissue)
    values = np.zeros(tissue.shape, np.uint8)
    for index, (left, top) in enumerate(tiles):
        area = tile_cells(tissue, left, top)
        height, width = tissue[area].shape
        values[area] = unpacked(await store.get_packed(tile_key(prefix, index)), width, height)
    return TumorMap(decoded(values), tissue, CELL, len(tiles), len(tiles), 0.0)


def tumor_map_workflow(
    open_slide: SlideOpener,
    scorer: Scorer,
    store: ResultStore,
    *,
    gpu: str | None = None,
    max_tiles: int = MAX_TILES,
) -> Workflow:
    async def scored(step: StepRun) -> Mapping[str, Any]:
        job = claimed_input(step)
        slide = await open_slide(step.tenant_id, job.slide_id)
        prefix = tiles_prefix(step.tenant_id, job.slide_id, step.job_id)
        started = time.perf_counter()
        ran = await score_tiles(slide, scorer, store, prefix, StepProgress(step), max_tiles)
        await report_gpu_seconds(step, time.perf_counter() - started, gpu)
        return {"ran": ran}

    async def stored(step: StepRun) -> Mapping[str, Any]:
        job = claimed_input(step)
        slide = await open_slide(step.tenant_id, job.slide_id)
        tiles = tiles_prefix(step.tenant_id, job.slide_id, step.job_id)
        tumor_map = await assembled(slide, store, tiles)
        prefix = result_set_prefix(step.tenant_id, job.slide_id, job.result_set_id)
        keys = await store_tumor_map(store, tumor_map, prefix, slide.mpp, slide.level_count)
        async with step.transaction() as connection:
            await connection.execute(SEAL_RESULT, {"job_id": step.job_id})
        return {"objects": len(keys), "tiles": tumor_map.tiles}

    return workflow({SCORED: scored, STORED: stored})
