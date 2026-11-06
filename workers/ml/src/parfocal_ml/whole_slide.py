import math
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray

from parfocal_common.cell_chunks import VERSION, ChunkError, encode
from parfocal_common.chunk_store import (
    MAX_CELLS_PER_CHUNK,
    Cell,
    chunk_fields,
    optional_fields,
    packed,
    placed,
    problem_of,
)
from parfocal_common.jobs import JobStoppedError, StepFunction, StepRun
from parfocal_common.model_runs import Area, Ordering, mark_area
from parfocal_common.result_store import ResultStore

TISSUE_CELL = 64
CORE_MODEL_PX = 1536
CONTEXT_MODEL_PX = 60


@dataclass(frozen=True)
class Window:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    def described(self) -> list[int]:
        return [self.x, self.y, self.width, self.height]


@dataclass(frozen=True)
class Tile:
    index: int
    core: Window

    def owns(self, x: float, y: float) -> bool:
        return self.core.x <= x < self.core.right and self.core.y <= y < self.core.bottom

    def with_halo(self, halo: int, slide: Window) -> Window:
        left = max(slide.x, self.core.x - halo)
        top = max(slide.y, self.core.y - halo)
        right = min(slide.right, self.core.right + halo)
        bottom = min(slide.bottom, self.core.bottom + halo)
        return Window(left, top, right - left, bottom - top)


@dataclass(frozen=True)
class TilePlan:
    slide: Window
    halo: int
    tiles: tuple[Tile, ...]

    def window_of(self, tile: Tile) -> Window:
        return tile.with_halo(self.halo, self.slide)


def tile_sizes(slide_mpp: float, model_mpp: float) -> tuple[int, int]:
    factor = model_mpp / slide_mpp
    return round(CORE_MODEL_PX * factor), round(CONTEXT_MODEL_PX * factor)


def cells_under(core: Window, cell: int) -> tuple[slice, slice]:
    rows = slice(core.y // cell, -(-core.bottom // cell))
    columns = slice(core.x // cell, -(-core.right // cell))
    return rows, columns


def has_tissue(tissue: NDArray[np.bool_], core: Window, cell: int) -> bool:
    return bool(tissue[cells_under(core, cell)].any())


def plan_tiles(
    slide: Window,
    bounds: Window,
    core: int,
    halo: int,
    tissue: NDArray[np.bool_] | None = None,
    cell: int = TISSUE_CELL,
) -> TilePlan:
    if core <= 0 or halo < 0:
        raise ValueError("A tile needs a positive core and a halo of zero or more")
    left, top = max(slide.x, bounds.x), max(slide.y, bounds.y)
    right, bottom = min(slide.right, bounds.right), min(slide.bottom, bounds.bottom)
    columns = max(0, math.ceil((right - left) / core))
    tiles: list[Tile] = []
    for row, y in enumerate(range(top, bottom, core)):
        for column, x in enumerate(range(left, right, core)):
            window = Window(x, y, min(core, right - x), min(core, bottom - y))
            if tissue is not None and not has_tissue(tissue, window, cell):
                continue
            tiles.append(Tile(row * columns + column, window))
    return TilePlan(slide, halo, tuple(tiles))


def tumour_score(tile: Tile, probability: NDArray[np.floating[Any]], cell: int) -> float:
    patch = probability[cells_under(tile.core, cell)]
    return float(patch.max()) if patch.size else 0.0


def ordered(
    plan: TilePlan,
    ordering: Ordering,
    probability: NDArray[np.floating[Any]] | None = None,
    cell: int = TISSUE_CELL,
) -> tuple[Tile, ...]:
    if ordering is Ordering.RASTER or probability is None:
        return plan.tiles
    return tuple(
        sorted(plan.tiles, key=lambda tile: (-tumour_score(tile, probability, cell), tile.index))
    )


class Detector(Protocol):
    classes: int

    async def detect(self, window: Window) -> Sequence[Cell]: ...


class Progress(Protocol):
    async def done(self) -> frozenset[int]: ...

    async def total(self, count: int) -> None: ...

    async def mark(self, tile: Tile, objects: int) -> None: ...

    async def should_stop(self) -> bool: ...


def run_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/s/{slide_id}/runs/{job_id}/"


def tile_key(prefix: str, index: int) -> str:
    return f"{prefix}tiles/tile-{index:06}.pfc"


def owned_cells(tile: Tile, cells: Sequence[Cell], classes: int) -> list[Cell]:
    kept: list[tuple[float, float, Cell]] = []
    for cell in cells:
        problem = problem_of(replace(cell, number=1), classes)
        if problem is not None:
            raise ChunkError(f"A cell in tile {tile.index} cannot be stored, because {problem}")
        x, y = placed(cell).centre
        if tile.owns(x, y):
            kept.append((y, x, cell))
    kept.sort(key=lambda item: (item[0], item[1]))
    if len(kept) > MAX_CELLS_PER_CHUNK:
        raise ChunkError(f"A tile holds at most {MAX_CELLS_PER_CHUNK} cells")
    return [replace(cell, number=position + 1) for position, (_, _, cell) in enumerate(kept)]


def tile_chunk(tile: Tile, cells: Sequence[Cell], classes: int) -> tuple[bytes, int]:
    members = [placed(cell) for cell in owned_cells(tile, cells, classes)]
    probs = bool(members) and all(member.cell.probs is not None for member in members)
    alt = any(member.cell.alt_class is not None for member in members)
    nucleus = any(member.cell.nucleus is not None for member in members)
    header = {
        "version": VERSION,
        "kind": "cells",
        "count": len(members),
        "classes": classes,
        "chunk": tile.index,
        "tile": tile.core.described(),
    }
    fields = chunk_fields(members) + optional_fields(members, probs=probs, alt=alt, nucleus=nucleus)
    return packed(encode(header, fields)), len(members)


async def run_tiles(
    plan: TilePlan,
    tiles: Sequence[Tile],
    detector: Detector,
    store: ResultStore,
    prefix: str,
    progress: Progress,
) -> int:
    await progress.total(len(tiles))
    done = await progress.done()
    ran = 0
    for tile in tiles:
        if tile.index in done:
            continue
        if await progress.should_stop():
            raise JobStoppedError
        cells = await detector.detect(plan.window_of(tile))
        data, count = tile_chunk(tile, cells, detector.classes)
        await store.put(tile_key(prefix, tile.index), data)
        await progress.mark(tile, count)
        ran += 1
    return ran


@dataclass(frozen=True)
class StepProgress:
    step: StepRun

    async def done(self) -> frozenset[int]:
        return await self.step.done_units()

    async def total(self, count: int) -> None:
        await self.step.set_total(count)

    async def mark(self, tile: Tile, objects: int) -> None:
        core = tile.core
        area = Area(core.x, core.y, core.width, core.height, objects)
        async with self.step.transaction() as connection:
            await mark_area(self.step, connection, tile.index, area)

    async def should_stop(self) -> bool:
        return await self.step.should_stop()


@dataclass(frozen=True)
class SlideTiles:
    plan: TilePlan
    tiles: tuple[Tile, ...]
    prefix: str


def model_running(
    tiles_of: Callable[[StepRun], Awaitable[SlideTiles]],
    detector: Detector,
    store: ResultStore,
) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        slide = await tiles_of(step)
        ran = await run_tiles(
            slide.plan, slide.tiles, detector, store, slide.prefix, StepProgress(step)
        )
        return {"tiles": len(slide.tiles), "ran": ran}

    return run
