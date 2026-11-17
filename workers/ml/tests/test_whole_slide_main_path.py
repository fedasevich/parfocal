import asyncio
import json
import math
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx2
import numpy as np
import pytest
from nuclei_support import ArrayReader, StainMaps
from numpy.typing import NDArray

from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_store import ObjectResultStore
from parfocal_ml.nuclei import PathoSamDetector
from parfocal_ml.whole_slide import (
    Tile,
    Window,
    plan_tiles,
    run_prefix,
    run_tiles,
    tile_sizes,
)

BUDGETS_FILE = Path(__file__).resolve().parents[3] / "perf-budgets.json"
SLIDE_MPP = 0.25
MODEL_MPP = 0.25
RADIUS = 9.0
SPACING = 40
CI_SLIDE = (1536, 1536)
CI_SAMPLES = 3
MAIN_PATH_RUNS = os.environ.get("PARFOCAL_MAIN_PATH_MODEL_RUNS")
MAIN_PATH_SLIDE = tuple(
    int(side) for side in os.environ.get("PARFOCAL_MAIN_PATH_SLIDE", "9216x6144").split("x")
)
MAIN_PATH_OUT = os.environ.get("PARFOCAL_BENCH_OUT")
LOCAL_STORAGE = StorageLocation(
    endpoint="http://127.0.0.1:9000",
    region="auto",
    bucket="parfocal-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)


def budget_limit(budget_id: str) -> float:
    budgets = json.loads(BUDGETS_FILE.read_text(encoding="utf-8"))["budgets"]
    return float(next(entry["limit"] for entry in budgets if entry["id"] == budget_id))


def nearest_rank(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * share) - 1)]


def nuclei_slide(width: int, height: int) -> NDArray[np.uint8]:
    image = np.full((height, width, 3), 240, np.uint8)
    size = int(RADIUS) * 2 + 1
    ys, xs = np.mgrid[0:size, 0:size]
    disk = (xs - RADIUS) ** 2 + (ys - RADIUS) ** 2 <= RADIUS**2
    for top in range(SPACING, height - SPACING, SPACING):
        for left in range(SPACING, width - SPACING, SPACING):
            image[top : top + size, left : left + size][disk] = 60
    return image


@dataclass
class Marks:
    marked: dict[int, int] = field(default_factory=dict[int, int])

    async def done(self) -> frozenset[int]:
        return frozenset()

    async def total(self, count: int) -> None:
        return None

    async def mark(self, tile: Tile, objects: int) -> None:
        self.marked[tile.index] = objects

    async def should_stop(self) -> bool:
        return False


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


@dataclass(frozen=True)
class Run:
    seconds: float
    tiles: int
    cells: int
    square_mm: float


async def whole_slide_run(slide: NDArray[np.uint8], store: Any, prefix: str) -> Run:
    height, width = slide.shape[:2]
    whole = Window(0, 0, width, height)
    core, halo = tile_sizes(SLIDE_MPP, MODEL_MPP)
    detector = PathoSamDetector(ArrayReader(slide, SLIDE_MPP), StainMaps(RADIUS))
    marks = Marks()
    started = time.perf_counter()
    plan = plan_tiles(whole, whole, core, halo)
    await run_tiles(plan, plan.tiles, detector, store, prefix, marks)
    seconds = time.perf_counter() - started
    square_mm = width * height * SLIDE_MPP**2 / 1e6
    return Run(seconds, len(plan.tiles), sum(marks.marked.values()), square_mm)


def a_prefix() -> str:
    return run_prefix(uuid.uuid4(), uuid.uuid4(), uuid.uuid4())


def test_a_stand_in_whole_slide_run_stays_within_budget():
    slide = nuclei_slide(*CI_SLIDE)
    load_before = os.getloadavg()
    runs = [
        asyncio.run(whole_slide_run(slide, MemoryStore(), a_prefix())) for _ in range(CI_SAMPLES)
    ]
    assert all(run.cells == runs[0].cells > 0 for run in runs)
    fastest_ms = min(run.seconds for run in runs) * 1000
    print(f"stand-in whole-slide run of {CI_SLIDE}, fastest of {CI_SAMPLES}: {fastest_ms:.0f} ms")
    if load_before[0] > (os.cpu_count() or 1):
        pytest.skip(f"Load average {load_before[0]:.1f} is above the core count")
    assert fastest_ms <= budget_limit("app.model-run-stand-in-ms")


async def into_minio(slide: NDArray[np.uint8], runs: int) -> tuple[list[Run], int]:
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(120.0)) as http:
        storage = ObjectStore(LOCAL_STORAGE, http)
        store = ObjectResultStore(storage)
        tenant = uuid.uuid4()
        measured: list[Run] = []
        try:
            await whole_slide_run(slide, store, run_prefix(tenant, uuid.uuid4(), uuid.uuid4()))
            for _ in range(runs):
                prefix = run_prefix(tenant, uuid.uuid4(), uuid.uuid4())
                measured.append(await whole_slide_run(slide, store, prefix))
        finally:
            keys = await storage.list_keys(f"t/{tenant}/")
            for key in keys:
                await storage.delete_object(key)
        return measured, len(keys)


@pytest.mark.bench
@pytest.mark.skipif(MAIN_PATH_RUNS is None, reason="set PARFOCAL_MAIN_PATH_MODEL_RUNS to a count")
def test_main_path_whole_slide_run_after_a_warm_up():
    assert MAIN_PATH_RUNS is not None
    slide = nuclei_slide(*MAIN_PATH_SLIDE)
    runs, removed = asyncio.run(into_minio(slide, int(MAIN_PATH_RUNS)))
    per_mm2 = [run.seconds / run.square_mm for run in runs]
    summary = {
        "slide_px": list(MAIN_PATH_SLIDE),
        "slide_mpp": SLIDE_MPP,
        "square_mm": runs[0].square_mm,
        "tiles": runs[0].tiles,
        "cells": runs[0].cells,
        "runs": len(runs),
        "seconds": [run.seconds for run in runs],
        "s_per_mm2": per_mm2,
        "median_s_per_mm2": statistics.median(per_mm2),
        "p95_s_per_mm2": nearest_rank(per_mm2, 0.95),
        "median_tiles_per_s": statistics.median(run.tiles / run.seconds for run in runs),
        "median_cells_per_s": statistics.median(run.cells / run.seconds for run in runs),
        "objects_removed": removed,
    }
    print(json.dumps(summary))
    if MAIN_PATH_OUT:
        Path(MAIN_PATH_OUT).write_text(json.dumps(summary, indent=2))
    assert all(run.cells == runs[0].cells > 0 for run in runs)
