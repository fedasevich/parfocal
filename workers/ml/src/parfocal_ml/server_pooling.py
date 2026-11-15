import math
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.nuclei import RegionReader, Rgb
from parfocal_ml.reviewed_features import (
    Collected,
    FeatureStore,
    Pooled,
    ReviewedNucleus,
    collect,
    waiting,
)
from parfocal_ml.sam_contract import GRAPHS, IMAGE_SIZE, onnx_dir, pixel_values
from parfocal_ml.whole_slide import Window

COVERAGE_SAMPLES = 8
CONTEXT_RING_CELLS = 2
TYPER_PROBABILITY_FLOOR = 1e-4
PATCH_WIDTH_MICRONS = 128
NUCLEI_MPP = 0.25
NUCLEI_FALLBACK_DOWNSAMPLE = 1.0
MIN_RING_VALUES = 6

type Embedding = NDArray[np.float32]


class Encoder(Protocol):
    def __call__(self, pixels: NDArray[np.float32]) -> Embedding: ...


@dataclass(frozen=True)
class SlideSource:
    reader: RegionReader
    width: int
    height: int
    downsamples: tuple[float, ...] = (1.0,)
    calibrated: bool = True


@dataclass(frozen=True)
class Patch:
    x: int
    y: int
    width: int
    height: int
    downsample: float

    def contains(self, x: float, y: float) -> bool:
        px = x / self.downsample
        py = y / self.downsample
        return self.x <= px < self.x + self.width and self.y <= py < self.y + self.height

    def holds(self, ring: NDArray[np.float64]) -> bool:
        return len(ring) >= MIN_RING_VALUES and all(
            self.contains(float(ring[at]), float(ring[at + 1])) for at in range(0, len(ring) - 1, 2)
        )

    @property
    def scale(self) -> float:
        return IMAGE_SIZE / max(self.width, self.height)

    def to_model(self, ring: NDArray[np.float64]) -> NDArray[np.float64]:
        points = ring.reshape(-1, 2) / self.downsample - np.array([self.x, self.y], np.float64)
        return (points * self.scale).reshape(-1)

    def level0(self) -> Window:
        return Window(
            rounded(self.x * self.downsample),
            rounded(self.y * self.downsample),
            max(1, rounded(self.width * self.downsample)),
            max(1, rounded(self.height * self.downsample)),
        )


def rounded(value: float) -> int:
    return math.floor(value + 0.5)


def nearest_on_log_scale(ratios: Sequence[float]) -> int:
    return min(range(len(ratios)), key=lambda index: (abs(math.log(ratios[index])), index))


def nuclei_level(source: SlideSource) -> tuple[float, int]:
    if not source.downsamples:
        raise ValueError("a slide needs at least one level")
    mpp = source.reader.mpp
    if source.calibrated and mpp > 0:
        ratios = [mpp * downsample / NUCLEI_MPP for downsample in source.downsamples]
    else:
        ratios = [downsample / NUCLEI_FALLBACK_DOWNSAMPLE for downsample in source.downsamples]
    downsample = source.downsamples[nearest_on_log_scale(ratios)]
    level_mpp = mpp * downsample if source.calibrated and mpp > 0 else NUCLEI_MPP
    return downsample, max(1, rounded(PATCH_WIDTH_MICRONS / level_mpp))


def patch_at(source: SlideSource, x: float, y: float) -> Patch:
    downsample, size = nuclei_level(source)
    level_width = max(1, int(source.width / downsample))
    level_height = max(1, int(source.height / downsample))
    width = max(1, min(size, level_width))
    height = max(1, min(size, level_height))
    left = rounded(x / downsample) - width // 2
    top = rounded(y / downsample) - height // 2
    return Patch(
        min(max(left, 0), level_width - width),
        min(max(top, 0), level_height - height),
        width,
        height,
        downsample,
    )


def points_in_ring(
    ring: NDArray[np.float64], xs: NDArray[np.float64], ys: NDArray[np.float64]
) -> NDArray[np.bool_]:
    hit = np.zeros(xs.shape, bool)
    points = ring.reshape(-1, 2)
    count = len(points)
    for i in range(count):
        xi, yi = points[i]
        xj, yj = points[i - 1]
        crosses = (yi > ys) != (yj > ys)
        with np.errstate(divide="ignore", invalid="ignore"):
            edge = (xj - xi) * (ys - yi) / (yj - yi) + xi
        hit ^= crosses & (xs < edge)
    return hit


def cell_coverage(ring: NDArray[np.float64], patch_size: float, grid: int) -> NDArray[np.float32]:
    out = np.zeros(grid * grid, np.float32)
    if len(ring) < MIN_RING_VALUES:
        return out
    cell = patch_size / grid
    xs = ring[0::2]
    ys = ring[1::2]
    first_column = max(0, math.floor(xs.min() / cell))
    last_column = min(grid - 1, math.floor(xs.max() / cell))
    first_row = max(0, math.floor(ys.min() / cell))
    last_row = min(grid - 1, math.floor(ys.max() / cell))
    offsets = (np.arange(COVERAGE_SAMPLES) + 0.5) / COVERAGE_SAMPLES
    total = COVERAGE_SAMPLES * COVERAGE_SAMPLES
    for row in range(first_row, last_row + 1):
        for column in range(first_column, last_column + 1):
            sample_x, sample_y = np.meshgrid((column + offsets) * cell, (row + offsets) * cell)
            hits = int(points_in_ring(ring, sample_x, sample_y).sum())
            out[row * grid + column] = hits / total
    return out


def centre_cell(ring: NDArray[np.float64], patch_size: float, grid: int) -> int:
    count = max(1, len(ring) // 2)
    x = float(ring[0::2].sum()) / count
    y = float(ring[1::2].sum()) / count
    cell = patch_size / grid
    column = min(grid - 1, max(0, math.floor(x / cell)))
    row = min(grid - 1, max(0, math.floor(y / cell)))
    return row * grid + column


def grown(mask: NDArray[np.bool_]) -> NDArray[np.bool_]:
    out = mask.copy()
    out[:, :-1] |= mask[:, 1:]
    out[:, 1:] |= mask[:, :-1]
    out[:-1, :] |= mask[1:, :]
    out[1:, :] |= mask[:-1, :]
    return out


def pool_nucleus(
    embedding: NDArray[np.floating],
    ring: Sequence[float] | NDArray[np.floating],
    patch_size: float = IMAGE_SIZE,
) -> NDArray[np.float32]:
    planes = np.asarray(embedding, np.float32)
    if planes.ndim == 4:
        planes = planes[0]
    channels, grid = planes.shape[0], planes.shape[1]
    if planes.shape != (channels, grid, grid):
        raise ValueError(f"the embedding must be channels x {grid} x {grid}")
    outline = np.asarray(ring, np.float64)
    weights = cell_coverage(outline, patch_size, grid).astype(np.float64)
    if weights.sum() == 0:
        weights = np.zeros(grid * grid, np.float64)
        weights[centre_cell(outline, patch_size, grid)] = 1
    footprint = (weights > 0).reshape(grid, grid)
    around = footprint
    for _ in range(CONTEXT_RING_CELLS):
        around = grown(around)
    context = (around & ~footprint).reshape(-1)
    flat = planes.reshape(channels, -1).astype(np.float64)
    inside = flat @ weights / weights.sum()
    outside = flat[:, context].mean(axis=1) if context.any() else inside
    return np.concatenate([inside, outside]).astype(np.float32)


def typer_start(nucleus: ReviewedNucleus, classes: int) -> NDArray[np.float32]:
    if nucleus.probabilities is None:
        values = np.full(classes, 1 / max(1, classes), np.float64)
    else:
        if len(nucleus.probabilities) != classes:
            raise ValueError(f"{nucleus.key} has {len(nucleus.probabilities)} typer outputs")
        values = np.asarray(nucleus.probabilities, np.float64)
    return np.log(np.maximum(TYPER_PROBABILITY_FLOOR, values)).astype(np.float32)


@dataclass(frozen=True)
class PlannedPatch:
    patch: Patch
    rgb: Rgb
    members: tuple[int, ...]


async def read_patches(
    source: SlideSource, nuclei: Sequence[ReviewedNucleus]
) -> list[PlannedPatch]:
    rings = [np.asarray(nucleus.outline, np.float64) for nucleus in nuclei]
    left = [index for index, ring in enumerate(rings) if len(ring) >= MIN_RING_VALUES]
    planned: list[PlannedPatch] = []
    while left:
        first = left[0]
        ring = rings[first]
        count = len(ring) // 2
        patch = patch_at(source, float(ring[0::2].sum()) / count, float(ring[1::2].sum()) / count)
        members = tuple(index for index in left if patch.holds(rings[index]))
        if first not in members:
            left.pop(0)
            continue
        rgb = await source.reader.read(patch.level0(), patch.width, patch.height)
        planned.append(PlannedPatch(patch, rgb, members))
        left = [index for index in left if index not in members]
    return planned


@dataclass(frozen=True)
class SlidePooling:
    keys: tuple[str, ...]
    pooled: Pooled
    unfitted: tuple[str, ...]


def pooled_from(
    planned: Sequence[PlannedPatch],
    nuclei: Sequence[ReviewedNucleus],
    encoder: Encoder,
    classes: int,
) -> SlidePooling:
    views = {nucleus.views for nucleus in nuclei}
    if len(views) > 1:
        raise ValueError(f"the nuclei of one slide come from runs with {sorted(views)} views")
    features: dict[int, NDArray[np.float32]] = {}
    for found in planned:
        embedding = encoder(pixel_values(found.rgb))
        for index in found.members:
            ring = found.patch.to_model(np.asarray(nuclei[index].outline, np.float64))
            features[index] = pool_nucleus(embedding, ring)
    fitted = sorted(features)
    unfitted = tuple(nuclei[index].key for index in range(len(nuclei)) if index not in features)
    width = 0 if not features else len(next(iter(features.values())))
    starts = [typer_start(nuclei[index], classes) for index in fitted]
    return SlidePooling(
        tuple(nuclei[index].key for index in fitted),
        Pooled(
            np.vstack([features[index] for index in fitted])
            if fitted
            else np.zeros((0, width), np.float32),
            {next(iter(views), 1): np.vstack(starts) if starts else np.zeros((0, classes))},
        ),
        unfitted,
    )


def poolable(nucleus: ReviewedNucleus) -> bool:
    return len(nucleus.outline) >= MIN_RING_VALUES


async def pool_reviewed(
    store: FeatureStore,
    tenant: uuid.UUID,
    typer: str,
    base_version: str,
    nuclei: Sequence[ReviewedNucleus],
    source_of: Callable[[str], Awaitable[SlideSource]],
    encoder: Encoder,
    classes: int,
) -> Collected:
    outlined = [nucleus for nucleus in nuclei if poolable(nucleus)]
    ready: dict[str, SlidePooling] = {}
    for slide, pending in waiting(store, tenant, typer, base_version, outlined).items():
        planned = await read_patches(await source_of(slide), pending)
        ready[slide] = pooled_from(planned, pending, encoder, classes)
    unfitted = {(slide, key) for slide, found in ready.items() for key in found.unfitted}
    kept = [nucleus for nucleus in outlined if (nucleus.slide, nucleus.key) not in unfitted]

    def pool(slide: str, pending: Sequence[ReviewedNucleus]) -> Pooled:
        found = ready.get(slide)
        if found is None or tuple(nucleus.key for nucleus in pending) != found.keys:
            raise RuntimeError(f"the nuclei waiting on {slide} changed while they were pooled")
        return found.pooled

    return collect(store, tenant, typer, base_version, kept, pool)


def nuclei_of(rows: Sequence[Mapping[str, Any]]) -> list[ReviewedNucleus]:
    return [
        ReviewedNucleus(
            slide=str(row["slide"]),
            task=str(row["task"]),
            kind=str(row["kind"]),
            number=int(row["number"]),
            reviewer=str(row["reviewer"]),
            final_class=None if row["final_class"] is None else str(row["final_class"]),
            rejected=bool(row["rejected"]),
            outline=tuple(float(value) for value in row["outline"]),
            reshaped=bool(row["reshaped"]),
            views=int(row["views"]),
            probabilities=None
            if row["probabilities"] is None
            else tuple(float(value) for value in row["probabilities"]),
        )
        for row in rows
    ]


class OnnxEncoder:
    def __init__(self, folder: Path | None = None) -> None:
        import onnxruntime as ort

        root = folder or onnx_dir()
        self.session: Any = ort.InferenceSession(
            str(root / GRAPHS.encoder), providers=["CPUExecutionProvider"]
        )

    def __call__(self, pixels: NDArray[np.float32]) -> Embedding:
        name = self.session.get_inputs()[0].name
        (embedding,) = self.session.run(None, {name: pixels})
        return np.asarray(embedding, np.float32)
