import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import pytest

from parfocal_common.chunk_store import Cell, chunk_of
from parfocal_common.jobs import JobStoppedError
from parfocal_common.model_runs import Ordering
from parfocal_ml.whole_slide import (
    CONTEXT_MODEL_PX,
    CORE_MODEL_PX,
    TISSUE_CELL,
    Tile,
    TilePlan,
    Window,
    ordered,
    plan_tiles,
    run_prefix,
    run_tiles,
    tile_key,
    tile_sizes,
)

SLIDE = Window(0, 0, 1000, 700)
CORE = 256
HALO = 20
PREFIX = run_prefix(uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3))


def square(x: float, y: float, size: float = 6) -> list[float]:
    return [x, y, x + size, y, x + size, y + size, x, y + size]


class FakeDetector:
    classes = 3

    def __init__(self) -> None:
        self.windows: list[Window] = []

    async def detect(self, window: Window) -> Sequence[Cell]:
        self.windows.append(window)
        cells: list[Cell] = []
        for y in range(-(-window.y // 37) * 37, window.bottom - 6, 37):
            for x in range(-(-window.x // 41) * 41, window.right - 6, 41):
                cells.append(Cell(0, square(x, y), class_index=(x + y) % 3, score=(x * y) % 256))
        return cells


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


@dataclass
class MemoryProgress:
    stop_after: int | None = None
    marked: dict[int, int] = field(default_factory=dict[int, int])
    counted: int = 0

    async def done(self) -> frozenset[int]:
        return frozenset(self.marked)

    async def total(self, count: int) -> None:
        self.counted = count

    async def mark(self, tile: Tile, objects: int) -> None:
        self.marked[tile.index] = objects

    async def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.marked) >= self.stop_after


def tissue_grid() -> np.ndarray:
    grid = np.zeros((-(-SLIDE.height // TISSUE_CELL), -(-SLIDE.width // TISSUE_CELL)), bool)
    grid[5:11, 0:12] = True
    return grid


def plan() -> TilePlan:
    return plan_tiles(SLIDE, SLIDE, CORE, HALO, tissue_grid())


def tumour_grid() -> np.ndarray:
    grid = np.zeros_like(tissue_grid(), dtype=float)
    grid[6:9, 10:14] = 0.9
    return grid


async def uninterrupted() -> MemoryStore:
    store = MemoryStore()
    whole = plan()
    await run_tiles(whole, whole.tiles, FakeDetector(), store, PREFIX, MemoryProgress())
    return store


def test_tile_sizes_follow_the_model_resolution():
    assert tile_sizes(0.25, 0.5) == (CORE_MODEL_PX * 2, CONTEXT_MODEL_PX * 2)


def test_plan_skips_tiles_without_tissue_and_keeps_raster_numbers():
    whole = plan()
    everything = plan_tiles(SLIDE, SLIDE, CORE, HALO)
    assert len(everything.tiles) == 4 * 3
    assert [tile.index for tile in everything.tiles] == list(range(12))
    kept = {tile.index for tile in whole.tiles}
    assert kept < set(range(12))
    assert kept == {4, 5, 6, 8, 9, 10}
    assert whole.tiles[-1].core == Window(512, 512, CORE, 188)


def test_halo_stays_inside_the_slide():
    whole = plan_tiles(SLIDE, SLIDE, CORE, HALO)
    assert whole.window_of(whole.tiles[0]) == Window(0, 0, CORE + HALO, CORE + HALO)
    assert whole.window_of(whole.tiles[5]) == Window(236, 236, CORE + 2 * HALO, CORE + 2 * HALO)


def test_tumour_first_orders_without_renumbering():
    whole = plan()
    first = ordered(whole, Ordering.TUMOR_FIRST, tumour_grid())
    assert sorted(first, key=lambda tile: tile.index) == list(whole.tiles)
    assert [tile.index for tile in first[:2]] == [6, 10]
    assert ordered(whole, Ordering.RASTER, tumour_grid()) == whole.tiles


async def test_each_cell_belongs_to_the_one_tile_holding_its_centre():
    store = await uninterrupted()
    centres: list[tuple[float, float]] = []
    for tile in plan().tiles:
        header, arrays = chunk_of(store.objects[tile_key(PREFIX, tile.index)])
        assert header["tile"] == tile.core.described()
        points = np.frombuffer(arrays["points"], np.float32).reshape(-1, 4, 2)
        for ring in points:
            x, y = ring.mean(axis=0)
            assert tile.owns(x, y)
            centres.append((float(x), float(y)))
    assert len(centres) == len(set(centres))


@pytest.mark.parametrize("ordering", list(Ordering))
async def test_a_killed_job_resumes_to_the_same_chunks(ordering: Ordering):
    expected = await uninterrupted()
    whole = plan()
    tiles = ordered(whole, ordering, tumour_grid())
    store = MemoryStore()
    progress = MemoryProgress(stop_after=len(tiles) // 2)
    with pytest.raises(JobStoppedError):
        await run_tiles(whole, tiles, FakeDetector(), store, PREFIX, progress)
    assert 0 < len(store.objects) < len(tiles)
    store.objects[tile_key(PREFIX, tiles[len(tiles) // 2].index)] = b"half written"

    progress.stop_after = None
    resumed = FakeDetector()
    ran = await run_tiles(whole, tiles, resumed, store, PREFIX, progress)

    assert ran == len(tiles) - len(tiles) // 2
    assert len(resumed.windows) == ran
    assert store.objects == expected.objects
    assert progress.counted == len(tiles)
