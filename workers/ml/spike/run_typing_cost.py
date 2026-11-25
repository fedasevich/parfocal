import argparse
import asyncio
import json
import time
from pathlib import Path

import numpy as np
import openslide
from scipy import ndimage

from parfocal_common.outline_types import SINGLE_VIEW, TYPER_TEMPERATURES
from parfocal_ml.lab_model_worker import ScaledReader
from parfocal_ml.nuclei import Maps, PathoSamDetector, Quality, Rgb
from parfocal_ml.nuclei_run_worker import typed_cells
from parfocal_ml.outline_typer_worker import OnnxTyper
from parfocal_ml.sam_contract import onnx_dir
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.whole_slide import Window, plan_tiles, tile_sizes

DOWNSAMPLE = 16
RADIUS = 9.0


class PixelReader:
    def __init__(self, rgb: np.ndarray) -> None:
        self.rgb = rgb

    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        out = np.full((height, width, 3), 255, np.uint8)
        bottom, right = min(self.rgb.shape[0], y + height), min(self.rgb.shape[1], x + width)
        out[: bottom - y, : right - x] = self.rgb[y:bottom, x:right]
        return out


class DarkMaps:
    def maps(self, rgb: Rgb) -> Maps:
        dark = rgb.mean(axis=2) < 128
        distance = np.asarray(ndimage.distance_transform_edt(dark), np.float32)
        depth = np.clip(distance / RADIUS, 0, 1)
        return np.stack([dark, 1 - depth, 1 - depth]).astype(np.float32)


async def measured(slide_path: Path, graph: Path) -> dict[str, object]:
    source = openslide.OpenSlide(str(slide_path))
    rgb = np.asarray(source.read_region((0, 0), 0, source.dimensions).convert("RGB"))
    mpp = float(source.properties["openslide.mpp-x"])
    height, width = rgb.shape[:2]
    slide = SlideImage(
        PixelReader(rgb), rgb[::DOWNSAMPLE, ::DOWNSAMPLE].copy(), DOWNSAMPLE, width, height, mpp
    )
    whole = Window(0, 0, width, height)
    tissue = slide.tissue()
    core, halo = tile_sizes(mpp, Quality.BEST.mpp)
    plan = plan_tiles(whole, whole, core, halo, tissue)
    detector = PathoSamDetector(
        ScaledReader(slide.reader, mpp), DarkMaps(), Quality.BEST, tissue=tissue
    )
    typer = OnnxTyper(graph)
    temperature = TYPER_TEMPERATURES[SINGLE_VIEW]
    seconds, cells, area = 0.0, 0, 0.0
    for tile in plan.tiles:
        found = await detector.detect(plan.window_of(tile))
        started = time.perf_counter()
        typed_cells(slide, found, typer, temperature)
        seconds += time.perf_counter() - started
        cells += len(found)
        area += tile.core.width * tile.core.height * (mpp / 1000) ** 2
    return {
        "slide": slide_path.name,
        "mpp": mpp,
        "tiles": len(plan.tiles),
        "cells_typed": cells,
        "tile_area_mm2": round(area, 3),
        "typer_seconds": round(seconds, 2),
        "seconds_per_mm2": round(seconds / area, 2),
        "ms_per_cell": round(1000 * seconds / max(1, cells), 3),
        "providers": typer.session.get_providers(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(prog="python workers/ml/spike/run_typing_cost.py")
    parser.add_argument("slide", type=Path)
    parser.add_argument("--graph", type=Path, default=onnx_dir() / "hovernext-pannuke.typer.onnx")
    parser.add_argument("--repeats", type=int, default=2)
    options = parser.parse_args()
    for _ in range(options.repeats):
        print(json.dumps(asyncio.run(measured(options.slide, options.graph))))


if __name__ == "__main__":
    main()
