import gzip
import json
import math
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import numpy as np
from numpy.typing import NDArray

from parfocal_common.result_imports import HEATMAP_FACTS, HEATMAP_GRID

if TYPE_CHECKING:
    from parfocal_common.result_store import ResultStore

STRIDE = 32
WINDOW = 224
MARGIN = (WINDOW - STRIDE) // 2
CELL = 2 * STRIDE
TILE_CELLS = 32
TILE_SIDE = TILE_CELLS * CELL + WINDOW - STRIDE
SCORES_PER_TILE = 2 * TILE_CELLS
SATURATION_FLOOR = 20.0
STORED_MAX = 255
PYRAMID_MIN_SIDE = 256
PYRAMID_GRID = "heatmap.{level}.bin"

type Grid = NDArray[np.float32]
type Mask = NDArray[np.bool_]
type Rgb = NDArray[np.uint8]


class RegionReader(Protocol):
    def read(self, x: int, y: int, width: int, height: int) -> Rgb: ...


class Scorer(Protocol):
    def score(self, rgb: Rgb) -> NDArray[np.floating[Any]]: ...


@dataclass(frozen=True)
class CellBox:
    left: int
    top: int
    right: int
    bottom: int


@dataclass(frozen=True)
class TumorMap:
    probability: Grid
    tissue: Mask
    cell: int
    tiles: int
    scored: int
    seconds: float


def saturation(rgb: Rgb) -> NDArray[np.float32]:
    values = rgb.astype(np.float32)
    high = values.max(axis=-1)
    low = values.min(axis=-1)
    return np.where(high > 0, (high - low) / np.maximum(high, 1), 0).astype(np.float32) * 255


def otsu(values: NDArray[np.floating[Any]]) -> float:
    counts, edges = np.histogram(values, bins=256, range=(0, 256))
    weights = counts.astype(np.float64)
    centres = (edges[:-1] + edges[1:]) / 2
    below = np.cumsum(weights)[:-1]
    above = weights.sum() - below
    below_sum = np.cumsum(weights * centres)[:-1]
    above_sum = (weights * centres).sum() - below_sum
    valid = (below > 0) & (above > 0)
    if not valid.any():
        return SATURATION_FLOOR
    spread = np.zeros_like(below)
    spread[valid] = (
        below[valid]
        * above[valid]
        * (below_sum[valid] / below[valid] - above_sum[valid] / above[valid]) ** 2
    )
    return max(float(centres[1:][int(np.argmax(spread))]), SATURATION_FLOOR)


def grid_shape(width: int, height: int, cell: int = CELL) -> tuple[int, int]:
    return math.ceil(height / cell), math.ceil(width / cell)


def tissue_cells(thumbnail: Rgb, downsample: float, width: int, height: int) -> Mask:
    tissue = saturation(thumbnail) > otsu(saturation(thumbnail).ravel())
    rows, columns = grid_shape(width, height)
    factor = CELL / downsample
    ys = np.minimum((np.arange(rows) * factor + factor / 2).astype(int), tissue.shape[0] - 1)
    xs = np.minimum((np.arange(columns) * factor + factor / 2).astype(int), tissue.shape[1] - 1)
    return tissue[np.ix_(ys, xs)]


def planned_tiles(tissue: Mask, box: CellBox | None = None) -> list[tuple[int, int]]:
    rows, columns = tissue.shape
    area = box or CellBox(0, 0, columns, rows)
    return [
        (left, top)
        for top in range(max(0, area.top), min(rows, area.bottom), TILE_CELLS)
        for left in range(max(0, area.left), min(columns, area.right), TILE_CELLS)
        if tissue[top : top + TILE_CELLS, left : left + TILE_CELLS].any()
    ]


def pooled(scores: NDArray[np.floating[Any]], rows: int, columns: int) -> Grid:
    if scores.shape != (SCORES_PER_TILE, SCORES_PER_TILE):
        raise ValueError(
            f"A tile scores {SCORES_PER_TILE} by {SCORES_PER_TILE}, got {scores.shape}"
        )
    kept = scores[: 2 * rows, : 2 * columns].astype(np.float32)
    return kept.reshape(rows, 2, columns, 2).mean(axis=(1, 3))


def map_slide(
    reader: RegionReader,
    scorer: Scorer,
    tissue: Mask,
    box: CellBox | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_tile: Callable[[int, int], None] | None = None,
) -> TumorMap:
    started = time.perf_counter()
    rows, columns = tissue.shape
    probability = np.zeros((rows, columns), np.float32)
    tiles = planned_tiles(tissue, box)
    scored = 0
    for left, top in tiles:
        if should_stop is not None and should_stop():
            break
        rgb = reader.read(left * CELL - MARGIN, top * CELL - MARGIN, TILE_SIDE, TILE_SIDE)
        height = min(TILE_CELLS, rows - top)
        width = min(TILE_CELLS, columns - left)
        cells = pooled(np.asarray(scorer.score(rgb)), height, width)
        on = tissue[top : top + height, left : left + width]
        probability[top : top + height, left : left + width] = np.where(on, cells, 0)
        scored += 1
        if on_tile is not None:
            on_tile(scored, len(tiles))
    return TumorMap(probability, tissue, CELL, len(tiles), scored, time.perf_counter() - started)


def stored_values(probability: Grid, tissue: Mask) -> NDArray[np.uint8]:
    scaled = np.rint(np.clip(probability, 0, 1) * STORED_MAX)
    return np.where(tissue, scaled, 0).astype(np.uint8)


def decoded(values: NDArray[np.uint8]) -> Grid:
    return (values.astype(np.float32) / STORED_MAX).astype(np.float32)


def halve(values: NDArray[np.uint8]) -> NDArray[np.uint8]:
    height, width = values.shape
    padded = np.pad(values, ((0, height % 2), (0, width % 2)), mode="constant")
    return np.maximum.reduce(
        [padded[0::2, 0::2], padded[1::2, 0::2], padded[0::2, 1::2], padded[1::2, 1::2]]
    )


def pyramid(values: NDArray[np.uint8]) -> list[NDArray[np.uint8]]:
    levels = [values]
    while max(levels[-1].shape) > PYRAMID_MIN_SIDE:
        levels.append(halve(levels[-1]))
    return levels


def packed(values: NDArray[np.uint8]) -> bytes:
    return gzip.compress(np.ascontiguousarray(values).tobytes(), 6, mtime=0)


def unpacked(data: bytes, width: int, height: int) -> NDArray[np.uint8]:
    return np.frombuffer(gzip.decompress(data), dtype=np.uint8).reshape(height, width)


def tissue_share(values: NDArray[np.uint8], tissue: Mask) -> float | None:
    total = float(values.sum(dtype=np.float64))
    if total <= 0:
        return None
    return round(float(values[tissue].sum(dtype=np.float64)) / total, 4)


def grid_level(cell: int, level_count: int | None) -> int | None:
    level = round(math.log2(cell))
    fits = 2**level == cell and (level_count is None or level < level_count)
    return level if fits else None


def stored_objects(
    tumor_map: TumorMap, prefix: str, slide_mpp: float | None, level_count: int | None = None
) -> Iterator[tuple[str, bytes]]:
    levels = pyramid(stored_values(tumor_map.probability, tumor_map.tissue))
    base = levels[0]
    height, width = base.shape
    steps = []
    for index, level in enumerate(levels[1:], start=1):
        key = f"{prefix}{PYRAMID_GRID.format(level=index)}"
        steps.append(
            {
                "width": level.shape[1],
                "height": level.shape[0],
                "downsample": float(tumor_map.cell * 2**index),
                "object_key": key,
            }
        )
        yield key, packed(level)
    yield f"{prefix}{HEATMAP_GRID}", packed(base)
    facts = {
        "width": width,
        "height": height,
        "dtype": "uint8",
        "object_key": f"{prefix}{HEATMAP_GRID}",
        "level": grid_level(tumor_map.cell, level_count),
        "downsample": float(tumor_map.cell),
        "mpp": slide_mpp * tumor_map.cell if slide_mpp else None,
        "tissue_share": tissue_share(base, tumor_map.tissue),
        "pyramid": steps,
        "reduction": "max",
    }
    yield f"{prefix}{HEATMAP_FACTS}", json.dumps(facts).encode()


async def store_tumor_map(
    store: ResultStore,
    tumor_map: TumorMap,
    prefix: str,
    slide_mpp: float | None,
    level_count: int | None = None,
) -> list[str]:
    keys = []
    for key, data in stored_objects(tumor_map, prefix, slide_mpp, level_count):
        await store.put(key, data)
        keys.append(key)
    return keys
