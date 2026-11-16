import json
import sys
from pathlib import Path

import numpy as np
import openslide
from numpy.typing import NDArray
from PIL import Image
from scipy.spatial import KDTree

from parfocal_ml.nuclei import OnnxPathoSam, Outline, instances, stitched_maps, traced, weights_dir
from parfocal_ml.whole_slide import Window

REFERENCE = Path(__file__).parents[1] / "tests/fixtures/pathosam-ais-cmu-1-small-region.json"
SLIDE = Path.home() / ".cache/parfocal/fixtures/CMU-1-Small-Region.svs"
CONFIGS = {"512 core, 64 halo": (512, 64), "896 core, 64 halo": (896, 64)}
TILE = Window(300, 700, 828, 828)
MODEL_MPP = 0.25
MATCH_MODEL_PX = 2.0


def polygon_area(ring: NDArray[np.float64]) -> float:
    xs, ys = ring[:, 0], ring[:, 1]
    return 0.5 * abs(float(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))))


def outlines(rgb: NDArray[np.uint8], model: OnnxPathoSam, core: int, halo: int) -> list[Outline]:
    labels, foreground = instances(stitched_maps(rgb, model, core, halo))
    return traced(labels, foreground)


def model_rgb(pixels: NDArray[np.uint8], window: Window, side: int) -> NDArray[np.uint8]:
    crop = pixels[window.y : window.bottom, window.x : window.right]
    return np.asarray(Image.fromarray(crop).resize((side, side), Image.Resampling.BILINEAR))


def compare(
    found: list[Outline], expected_xy: NDArray[np.float64], expected_area: NDArray[np.float64]
) -> dict[str, float]:
    centres = np.array([outline.ring.mean(axis=0) for outline in found])
    distance, nearest = KDTree(centres).query(expected_xy)
    matched = distance < MATCH_MODEL_PX
    ratios = [
        polygon_area(found[index].ring) / expected_area[row]
        for row, index in enumerate(np.asarray(nearest).tolist())
        if matched[row]
    ]
    return {
        "count": len(found),
        "expected": len(expected_xy),
        "count_change_percent": 100 * (len(found) - len(expected_xy)) / len(expected_xy),
        "matched_percent": 100 * float(matched.mean()),
        "median_area_ratio": float(np.median(ratios)),
    }


def main() -> None:
    folder = weights_dir()
    if folder is None:
        raise SystemExit("The PathoSAM graphs are not in the local model cache")
    model = OnnxPathoSam(folder, providers=["CPUExecutionProvider"])
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
    report: dict[str, object] = {"slide_mpp": mpp, "reference_model_px": side}
    for name, (core, halo) in CONFIGS.items():
        found = outlines(rgb, model, core, halo)
        report[f"reference, {name}"] = compare(found, expected_xy, expected[:, 2])
    tile_side = round(TILE.width * mpp / MODEL_MPP)
    tile_rgb = model_rgb(pixels, TILE, tile_side)
    old = outlines(tile_rgb, model, *CONFIGS["512 core, 64 halo"])
    new = outlines(tile_rgb, model, *CONFIGS["896 core, 64 halo"])
    old_xy = np.array([outline.ring.mean(axis=0) for outline in old])
    old_area = np.array([polygon_area(outline.ring) for outline in old])
    report["tile_model_px"] = tile_side
    report["tile, 896 core against 512 core"] = compare(new, old_xy, old_area)
    text = json.dumps(report, indent=2)
    print(text)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text)


if __name__ == "__main__":
    main()
