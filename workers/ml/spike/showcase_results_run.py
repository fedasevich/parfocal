import argparse
import gc
import json
import platform
import time
from pathlib import Path

import numpy as np
import openslide
import torch
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure
from skimage.draw import polygon
from skimage.measure import approximate_polygon

from parfocal_ml.exemplar_search import ring_of
from parfocal_ml.instanseg import RELEASE, WEIGHTS, full_size, model_dir, model_input
from parfocal_ml.outline_typer_worker import OnnxTyper
from parfocal_ml.sam_contract import onnx_dir
from parfocal_ml.tumor_areas import LISTED_FROM_PEAK, OUTLINE_AT
from parfocal_ml.tumor_map import (
    CELL,
    TILE_CELLS,
    CellBox,
    decoded,
    map_slide,
    stored_values,
    tissue_cells,
)
from parfocal_ml.tumor_map_worker import OnnxTumorScorer, local_weights
from parfocal_ml.typer import TYPER_MPP, Outline, type_nuclei

CROP = 2048
TYPER_SIDE = 1024
TYPER_MARGIN = 32
CELL_NAMES = {"tumor": "Tumor", "stroma": "Stroma", "immune": "Immune", "other": "Other"}
REGION_CLASS = "Tumor"
THUMB_DOWNSAMPLE = 64
SIMPLIFY_PX = 1.0
LEAST_RING_POINTS = 3
MAP_TILES = 2
TUMOR_MPP = 0.243
RESCALE_FROM = 1.2


class OpenSlideReader:
    def __init__(self, slide):
        self.slide = slide

    def read(self, x, y, width, height):
        rgba = np.asarray(self.slide.read_region((int(x), int(y)), 0, (int(width), int(height))))
        rgb = rgba[..., :3].copy()
        rgb[rgba[..., 3] == 0] = 255
        return rgb


class ScaledReader:
    def __init__(self, slide, scale):
        self.reader = OpenSlideReader(slide)
        self.scale = scale

    def read(self, x, y, width, height):
        if self.scale == 1:
            return self.reader.read(x, y, width, height)
        left, top = int(np.floor(x / self.scale)), int(np.floor(y / self.scale))
        side_x = int(np.ceil(width / self.scale)) + 1
        side_y = int(np.ceil(height / self.scale)) + 1
        rgb = self.reader.read(left, top, side_x, side_y)
        image = Image.fromarray(rgb).resize(
            (round(side_x * self.scale), round(side_y * self.scale)), Image.Resampling.BILINEAR
        )
        dx, dy = round(x - left * self.scale), round(y - top * self.scale)
        return np.ascontiguousarray(np.asarray(image)[dy : dy + height, dx : dx + width])


def map_scale(mpp):
    return mpp / TUMOR_MPP if mpp > TUMOR_MPP * RESCALE_FROM else 1.0


def tissue_of(slide, scale=1.0):
    level = slide.get_best_level_for_downsample(THUMB_DOWNSAMPLE + 0.5)
    rgba = np.asarray(slide.read_region((0, 0), level, slide.level_dimensions[level]))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    width, height = slide.dimensions
    return tissue_cells(
        rgb, slide.level_downsamples[level] * scale, round(width * scale), round(height * scale)
    )


def densest_box(tissue, side):
    counts = ndimage.uniform_filter(tissue.astype(np.float32), size=side, mode="constant")
    row, col = np.unravel_index(int(np.argmax(counts)), counts.shape)
    top = max(0, min(row - side // 2, tissue.shape[0] - side))
    left = max(0, min(col - side // 2, tissue.shape[1] - side))
    return CellBox(
        int(left), int(top), min(left + side, tissue.shape[1]), min(top + side, tissue.shape[0])
    )


def read_rgb(slide, left, top, width, height):
    return OpenSlideReader(slide).read(left, top, width, height)


def segment(rgb, mpp):
    model = torch.jit.load(str(model_dir() / "instanseg.pt"), map_location="cpu").eval()
    pixels = model_input(rgb, mpp)
    started = time.perf_counter()
    with torch.no_grad():
        small = model(torch.from_numpy(pixels)).numpy()[0, 0].astype(np.int32)
    segment_s = time.perf_counter() - started
    labels = full_size(small, rgb.shape[:2])
    started = time.perf_counter()
    rings = rings_of(labels)
    rings_s = time.perf_counter() - started
    del model
    gc.collect()
    return rings, {"input_side": list(pixels.shape[2:]), "segment_s": segment_s, "rings_s": rings_s}


def rings_of(labels):
    rings = []
    for label, found in enumerate(ndimage.find_objects(labels), start=1):
        if found is None:
            continue
        top, left = found[0].start, found[1].start
        ring = ring_of(labels[found] == label)
        if ring is None or len(ring) < 6:
            continue
        points = np.asarray(ring).reshape(-1, 2) + np.array([left, top])
        closed = np.vstack([points, points[:1]])
        simple = approximate_polygon(closed, SIMPLIFY_PX)[:-1]
        if len(simple) < LEAST_RING_POINTS:
            continue
        rings.append([float(value) for value in np.rint(simple).ravel()])
    return rings


def outline_of(ring, left, top, right, bottom):
    xs = np.asarray(ring[0::2]) - left
    ys = np.asarray(ring[1::2]) - top
    x0, y0 = int(np.floor(xs.min())), int(np.floor(ys.min()))
    x1, y1 = int(np.ceil(xs.max())) + 1, int(np.ceil(ys.max())) + 1
    mask = np.zeros((y1 - y0, x1 - x0), bool)
    rows, cols = polygon(ys - y0, xs - x0, mask.shape)
    mask[rows, cols] = True
    return Outline(mask=mask, x=x0, y=y0)


def type_cells(rgb, rings, mpp):
    typer = OnnxTyper(onnx_dir() / "hovernext-pannuke.typer.onnx")
    side = max(256, round(TYPER_SIDE * TYPER_MPP / mpp))
    height, width = rgb.shape[:2]
    centres = [(float(np.mean(ring[0::2])), float(np.mean(ring[1::2]))) for ring in rings]
    typed = [None] * len(rings)
    started = time.perf_counter()
    windows = 0
    for top in range(0, height, side):
        for left in range(0, width, side):
            chosen = [
                index
                for index, (x, y) in enumerate(centres)
                if left <= x < left + side and top <= y < top + side
            ]
            if not chosen:
                continue
            x0, y0 = max(0, left - TYPER_MARGIN), max(0, top - TYPER_MARGIN)
            x1 = min(width, left + side + TYPER_MARGIN)
            y1 = min(height, top + side + TYPER_MARGIN)
            window = np.ascontiguousarray(rgb[y0:y1, x0:x1])
            outlines = [outline_of(rings[index], x0, y0, x1, y1) for index in chosen]
            nuclei = type_nuclei(window, outlines, typer, mpp)
            for index, nucleus in zip(chosen, nuclei, strict=True):
                typed[index] = nucleus
            windows += 1
    seconds = time.perf_counter() - started
    del typer
    gc.collect()
    return typed, {"typer_windows": windows, "typer_window_px": side, "typer_s": seconds}


def cell_features(rings, typed, left, top):
    features = []
    for number, (ring, nucleus) in enumerate(zip(rings, typed, strict=True), start=1):
        points = [[int(ring[i]) + left, int(ring[i + 1]) + top] for i in range(0, len(ring), 2)]
        points.append(points[0])
        probabilities = {CELL_NAMES[k]: round(v, 2) for k, v in nucleus.probabilities.items()}
        features.append(
            {
                "type": "Feature",
                "id": number,
                "geometry": {"type": "Polygon", "coordinates": [points]},
                "properties": {
                    "objectType": "cell",
                    "classification": {"name": CELL_NAMES[nucleus.type]},
                    "score": round(max(nucleus.probabilities.values()), 3),
                    "probabilities": probabilities,
                },
            }
        )
    return features


def tumor_regions(slide, box, scale=1.0, map_tiles=MAP_TILES, any_area=False):
    tissue = tissue_of(slide, scale)
    if box is None:
        box = densest_box(tissue, map_tiles * TILE_CELLS)
    scorer = OnnxTumorScorer(local_weights())
    started = time.perf_counter()
    found = map_slide(ScaledReader(slide, scale), scorer, tissue, box)
    seconds = time.perf_counter() - started
    grid = decoded(stored_values(found.probability, found.tissue))
    window = grid[box.top : box.bottom, box.left : box.right]
    labels, count = ndimage.label(window >= OUTLINE_AT, structure=np.ones((3, 3), bool))
    peaks = [float(window[labels == label].max()) for label in range(1, count + 1)]
    listed_from = LISTED_FROM_PEAK
    if any_area and not any(peak >= LISTED_FROM_PEAK for peak in peaks):
        listed_from = OUTLINE_AT
    objects = []
    for label in range(1, count + 1):
        mask = labels == label
        peak = peaks[label - 1]
        if peak < listed_from:
            continue
        contours = measure.find_contours(np.pad(mask, 1).astype(np.float64), 0.5)
        contour = max(contours, key=len) - 1
        points = [
            [
                round((box.left + float(col) + 0.5) * CELL / scale),
                round((box.top + float(row) + 0.5) * CELL / scale),
            ]
            for row, col in contour
        ]
        if points[0] != points[-1]:
            points.append(points[0])
        objects.append(
            {
                "kind": "region",
                "geometry": {"type": "Polygon", "coordinates": [points]},
                "class": REGION_CLASS,
                "score": round(peak, 4),
                "properties": {"cells": int(mask.sum())},
            }
        )
    scorer_providers = scorer.providers
    del scorer
    gc.collect()
    report = {
        "box_cells": [box.left, box.top, box.right, box.bottom],
        "box_px": [
            round(value * CELL / scale) for value in (box.left, box.top, box.right, box.bottom)
        ],
        "scale": scale,
        "listed_from_peak": listed_from,
        "tiles": found.scored,
        "map_s": seconds,
        "areas_over_outline": count,
        "regions": len(objects),
        "providers": list(scorer_providers),
    }
    return objects, report


def overlay(rgb, rings, regions, left, top, path):
    image = Image.fromarray(rgb).convert("RGB")
    draw = ImageDraw.Draw(image)
    for ring in rings:
        draw.line([*zip(ring[0::2], ring[1::2], strict=True), (ring[0], ring[1])], fill=(0, 200, 0))
    for region in regions:
        points = [(x - left, y - top) for x, y in region["geometry"]["coordinates"][0]]
        draw.line(points, fill=(255, 0, 0), width=4)
    image.thumbnail((1024, 1024))
    image.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("slide", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--crop", type=int, nargs=2)
    parser.add_argument("--regions", action="store_true")
    parser.add_argument("--map-box", type=int, nargs=4)
    parser.add_argument("--map-tiles", type=int, default=MAP_TILES)
    parser.add_argument("--any-area", action="store_true")
    parser.add_argument("--dense-crop", action="store_true")
    parser.add_argument("--mpp", type=float)
    parser.add_argument("--name")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    slide = openslide.OpenSlide(args.slide)
    mpp = args.mpp or float(slide.properties["openslide.mpp-x"])
    scale = map_scale(mpp)
    report = {
        "slide": args.name or args.slide.name,
        "dimensions": list(slide.dimensions),
        "mpp": mpp,
        "machine": platform.platform(),
        "torch": torch.__version__,
    }
    regions = []
    map_box = CellBox(*args.map_box) if args.map_box else None
    if args.regions:
        regions, report["tumor_map"] = tumor_regions(
            slide, map_box, scale, args.map_tiles, args.any_area
        )
        map_box = CellBox(*report["tumor_map"]["box_cells"])
        document = {"format": "parfocal-results", "version": 1, "objects": regions}
        (args.out / "regions.parfocal.json").write_text(json.dumps(document) + "\n")
    if args.crop:
        left, top = args.crop
    elif map_box is not None and not args.dense_crop:
        left = max(0, round((map_box.left + map_box.right) * CELL / scale / 2) - CROP // 2)
        top = max(0, round((map_box.top + map_box.bottom) * CELL / scale / 2) - CROP // 2)
    else:
        box = densest_box(tissue_of(slide), CROP // CELL)
        left, top = box.left * CELL, box.top * CELL
    width = min(CROP, slide.dimensions[0] - left)
    height = min(CROP, slide.dimensions[1] - top)
    rgb = read_rgb(slide, left, top, width, height)
    rings, segmented = segment(rgb, mpp)
    typed, typing = type_cells(rgb, rings, mpp)
    features = cell_features(rings, typed, left, top)
    document = {"type": "FeatureCollection", "features": features}
    (args.out / "cells.geojson").write_text(json.dumps(document) + "\n")
    counts = {}
    for feature in features:
        name = feature["properties"]["classification"]["name"]
        counts[name] = counts.get(name, 0) + 1
    report["cells"] = {
        "crop_px": [left, top, left + width, top + height],
        "weights": f"{RELEASE}/{WEIGHTS}",
        "count": len(features),
        "by_class": counts,
        **segmented,
        **typing,
    }
    report["bytes"] = {path.name: path.stat().st_size for path in sorted(args.out.glob("*.*json"))}
    overlay(rgb, rings, regions, left, top, args.out.parent / f"{args.out.name}-overlay.png")
    (args.out.parent / f"{args.out.name}-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
