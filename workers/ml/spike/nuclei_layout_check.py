import asyncio
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
import openslide
from nuclei_window_size_check import REFERENCE, SLIDE, TILE, compare, model_rgb, polygon_area
from numpy.typing import NDArray
from PIL import Image

from parfocal_common.chunk_store import Cell
from parfocal_ml.nuclei import (
    WINDOW_HALO_PX,
    WINDOW_PX,
    Layout,
    OnnxPathoSam,
    Outline,
    PathoSamDetector,
    Quality,
    Rgb,
    Span,
    grid_spans,
    instances,
    model_size,
    stitched_maps,
    tissue_filter,
    traced,
    weights_dir,
)
from parfocal_ml.stored_slides import LevelTable, opened
from parfocal_ml.whole_slide import TISSUE_CELL, Window, plan_tiles, tile_sizes

CAMELYON = Path.home() / ".cache/parfocal/fixtures/test_001.tif"
MODEL_MPP = Quality.BEST.mpp
EDGE_TILES = 2


def balanced_spans(length: int, core: int, halo: int) -> list[Span]:
    if length <= core + 2 * halo:
        return [(0, length)]
    inner = length - 2 * halo
    count = math.ceil(inner / core)
    cuts = [0, *(halo + round(i * inner / count) for i in range(1, count)), length]
    return list(itertools.pairwise(cuts))


class Counted:
    def __init__(self, model: OnnxPathoSam) -> None:
        self.model = model
        self.windows = 0

    def maps(self, rgb: Rgb) -> NDArray[np.float32]:
        self.windows += 1
        return self.model.maps(rgb)


def outlines(rgb: Rgb, model: Counted, layout: Layout) -> list[Outline]:
    labels, foreground = instances(stitched_maps(rgb, model, layout=layout))
    return traced(labels, foreground)


def layout_against_grid(rgb: Rgb, model: Counted) -> dict[str, object]:
    model.windows = 0
    old = outlines(rgb, model, grid_spans)
    grid_windows = model.windows
    model.windows = 0
    new = outlines(rgb, model, balanced_spans)
    old_xy = np.array([outline.ring.mean(axis=0) for outline in old])
    old_area = np.array([polygon_area(outline.ring) for outline in old])
    report = compare(new, old_xy, old_area)
    report["windows"] = {"grid": grid_windows, "balanced": model.windows}
    return report


def kept_windows(tissue: NDArray[np.bool_], window: Window, mpp: float) -> int:
    width, height = model_size(window, mpp / MODEL_MPP)
    wanted = tissue_filter(tissue, window, width / window.width, height / window.height)
    return sum(
        wanted(
            max(0, y0 - WINDOW_HALO_PX),
            max(0, x0 - WINDOW_HALO_PX),
            min(height, y1 + WINDOW_HALO_PX),
            min(width, x1 + WINDOW_HALO_PX),
        )
        for y0, y1 in grid_spans(height, WINDOW_PX, WINDOW_HALO_PX)
        for x0, x1 in grid_spans(width, WINDOW_PX, WINDOW_HALO_PX)
    )


def in_tissue(cell: Cell, tissue: NDArray[np.bool_]) -> bool:
    x, y = float(np.mean(cell.ring[0::2])), float(np.mean(cell.ring[1::2]))
    return bool(tissue[int(y) // TISSUE_CELL, int(x) // TISSUE_CELL])


def skip_check(model: Counted) -> dict[str, object]:
    raw = openslide.OpenSlide(str(CAMELYON))
    mpp = float(raw.properties["openslide.mpp-x"])
    table = LevelTable(raw.dimensions[0], raw.dimensions[1], mpp, raw.level_count)
    raw.close()
    slide = opened(CAMELYON, table)
    tissue = slide.tissue()
    core, halo = tile_sizes(mpp, MODEL_MPP)
    whole = Window(0, 0, slide.width, slide.height)
    plan = plan_tiles(whole, whole, core, halo, tissue)
    edge = [
        tile for tile in plan.tiles if 6 <= kept_windows(tissue, plan.window_of(tile), mpp) <= 10
    ]
    chosen = edge[:: max(1, len(edge) // EDGE_TILES)][:EDGE_TILES]

    class Reader:
        def __init__(self) -> None:
            self.mpp = mpp

        async def read(self, window: Window, width: int, height: int) -> Rgb:
            rgb = slide.reader.read(window.x, window.y, window.width, window.height)
            return np.asarray(
                Image.fromarray(rgb).resize((width, height), Image.Resampling.BILINEAR)
            )

    reader = Reader()
    report: list[dict[str, object]] = []
    for tile in chosen:
        window = plan.window_of(tile)
        runs = {}
        for name, mask in (("all", None), ("skip", tissue)):
            model.windows = 0
            detector = PathoSamDetector(reader, model, Quality.BEST, tissue=mask)
            cells = asyncio.run(detector.detect(window))
            runs[name] = (model.windows, {tuple(c.ring) for c in cells if in_tissue(c, tissue)})
        everything, skipped = runs["all"][1], runs["skip"][1]
        report.append(
            {
                "tile": tile.index,
                "windows": {"all": runs["all"][0], "skip": runs["skip"][0]},
                "cells_in_tissue": {"all": len(everything), "skip": len(skipped)},
                "identical": everything == skipped,
            }
        )
    dense = next(
        tile for tile in plan.tiles if kept_windows(tissue, plan.window_of(tile), mpp) == 16
    )
    window = plan.window_of(dense)
    rgb = asyncio.run(reader.read(window, *model_size(window, mpp / MODEL_MPP)))
    return {
        "edge_tiles": report,
        "dense_tile": {"tile": dense.index, **layout_against_grid(rgb, model)},
    }


def main() -> None:
    folder = weights_dir()
    if folder is None:
        raise SystemExit("The PathoSAM graphs are not in the local model cache")
    model = Counted(OnnxPathoSam(folder, providers=["CPUExecutionProvider"]))
    slide = openslide.OpenSlide(str(SLIDE))
    mpp = float(slide.properties["openslide.mpp-x"])
    pixels = np.asarray(slide.read_region((0, 0), 0, slide.dimensions).convert("RGB"))
    reference = json.loads(REFERENCE.read_text())
    window = Window(*reference["window"])
    side = reference["model_size"][0]
    rgb = model_rgb(pixels, window, side)
    expected = np.array(reference["nuclei"], float)
    scale = side / window.width
    expected_xy = np.column_stack(
        [
            (expected[:, 0] - window.x + 0.5) * scale - 0.5,
            (expected[:, 1] - window.y + 0.5) * scale - 0.5,
        ]
    )
    report: dict[str, object] = {}
    for name, layout in (("grid", grid_spans), ("balanced", balanced_spans)):
        model.windows = 0
        found = outlines(rgb, model, layout)
        report[f"reference, {name}"] = {
            **compare(found, expected_xy, expected[:, 2]),
            "windows": model.windows,
        }
    tile_rgb = model_rgb(pixels, TILE, round(TILE.width * mpp / MODEL_MPP))
    report["cmu tile, balanced against grid"] = layout_against_grid(tile_rgb, model)
    report["test_001"] = skip_check(model)
    text = json.dumps(report, indent=2)
    print(text)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text)


if __name__ == "__main__":
    main()
