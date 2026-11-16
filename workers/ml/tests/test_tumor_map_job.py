import asyncio
import json
import uuid
from dataclasses import dataclass, field

import numpy as np
import pytest
from tumor_map_support import CentreScorer, MemoryStore, fixture_slide, opener

from parfocal_common.jobs import JobStoppedError, StepFailedError
from parfocal_common.result_imports import HEATMAP_FACTS, HEATMAP_GRID
from parfocal_common.tumor_maps import KIND, STEPS, tiles_prefix
from parfocal_ml.gpu_pool import POOLS, Family
from parfocal_ml.priority_gate import WrongLaneError, check_lane
from parfocal_ml.tumor_map import map_slide, store_tumor_map, stored_values, unpacked
from parfocal_ml.tumor_map_job import (
    POOL_FAMILY,
    TOO_LARGE,
    assembled,
    score_tiles,
    tumor_map_workflow,
)

PREFIX = tiles_prefix(uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3))
RESULT = "t/1/s/2/results/4/"


@dataclass
class MemoryProgress:
    stop_after: int | None = None
    marked: list[int] = field(default_factory=list[int])
    counted: int = 0

    async def done(self) -> frozenset[int]:
        return frozenset(self.marked)

    async def total(self, count: int) -> None:
        self.counted = count

    async def mark(self, index: int) -> None:
        self.marked.append(index)

    async def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.marked) >= self.stop_after


def mapped_in_one_pass() -> np.ndarray:
    slide = fixture_slide()
    tumor_map = map_slide(slide.reader, CentreScorer(), slide.tissue())
    return stored_values(tumor_map.probability, tumor_map.tissue)


async def run_job(store: MemoryStore, progress: MemoryProgress) -> list[str]:
    slide = fixture_slide()
    await score_tiles(slide, CentreScorer(), store, PREFIX, progress)
    tumor_map = await assembled(slide, store, PREFIX)
    return await store_tumor_map(store, tumor_map, RESULT, slide.mpp, slide.level_count)


def test_the_job_maps_the_fixture_slide_into_a_stored_heatmap():
    store, progress = MemoryStore(), MemoryProgress()
    keys = asyncio.run(run_job(store, progress))
    assert progress.counted == 4
    assert progress.marked == [0, 1, 2, 3]
    assert f"{RESULT}{HEATMAP_GRID}" in keys
    facts = json.loads(store.objects[f"{RESULT}{HEATMAP_FACTS}"])
    assert (facts["width"], facts["height"], facts["downsample"]) == (44, 40, 64.0)
    assert facts["level"] == 6
    assert facts["mpp"] == pytest.approx(16.0)
    grid = unpacked(store.objects[f"{RESULT}{HEATMAP_GRID}"], 44, 40)
    np.testing.assert_array_equal(grid, mapped_in_one_pass())
    assert set(np.unique(grid[10:14, 20:36])) == {20}
    assert set(np.unique(grid[20:30, 8:18])) == {60}
    assert grid[:4].max() == 0


def test_a_stopped_job_resumes_without_rescoring_its_tiles():
    store = MemoryStore()
    progress = MemoryProgress(stop_after=2)
    with pytest.raises(JobStoppedError):
        asyncio.run(run_job(store, progress))
    scored_first = dict(store.objects)
    progress.stop_after = None
    asyncio.run(run_job(store, progress))
    assert progress.marked == [0, 1, 2, 3]
    assert all(store.objects[key] == data for key, data in scored_first.items())
    grid = unpacked(store.objects[f"{RESULT}{HEATMAP_GRID}"], 44, 40)
    np.testing.assert_array_equal(grid, mapped_in_one_pass())


def test_a_slide_over_the_tile_cap_fails_before_any_tile_is_scored():
    store, progress = MemoryStore(), MemoryProgress()
    slide = fixture_slide()
    with pytest.raises(StepFailedError) as raised:
        asyncio.run(score_tiles(slide, CentreScorer(), store, PREFIX, progress, max_tiles=3))
    assert raised.value.code == TOO_LARGE
    assert (store.objects, progress.marked) == ({}, [])


def test_the_workflow_has_the_tumor_map_steps():
    plan = tumor_map_workflow(opener(fixture_slide()), CentreScorer(), MemoryStore())
    assert plan.kind == KIND
    assert tuple(step.name for step in plan.steps) == STEPS


def test_the_tumor_map_runs_in_a_batch_pool_and_never_in_the_interactive_one():
    pools = {pool.family: pool for pool in POOLS}
    assert POOL_FAMILY is Family.DETECTOR_GOOD
    assert pools[POOL_FAMILY].min_containers == 0
    check_lane(pools[POOL_FAMILY], KIND)
    with pytest.raises(WrongLaneError):
        check_lane(pools[Family.EMBEDDER], KIND)
