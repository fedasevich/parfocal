from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.optimize import minimize
from scipy.special import expit

from parfocal_ml.tumor_map import CELL, MARGIN, TILE_CELLS, TILE_SIDE, RegionReader, Rgb

PROBE_PATCH = 224
PROBE_SPACING_UM = 0.5
CENTRE_LABEL = 4
LABELS_PER_ROW = 9
DEFAULT_BLOCK = 2
DEFAULT_BATCH = 16
DEFAULT_STRENGTH = 1.0

type Features = NDArray[np.float32]


class Embedder(Protocol):
    def embed(self, patches: Rgb) -> Features: ...


@dataclass(frozen=True)
class Normalization:
    mean: tuple[float, float, float]
    std: tuple[float, float, float]


@dataclass(frozen=True)
class TrainingPatch:
    slide: str
    x: int
    y: int
    tumor: bool


def read_side(slide_spacing_um: float) -> int:
    return round(PROBE_PATCH * PROBE_SPACING_UM / slide_spacing_um)


def resized(region: Rgb) -> Rgb:
    if region.shape[:2] == (PROBE_PATCH, PROBE_PATCH):
        return region
    image = Image.fromarray(region).resize((PROBE_PATCH, PROBE_PATCH), Image.Resampling.BILINEAR)
    return np.asarray(image)


def normalized(patches: Rgb, normalization: Normalization) -> NDArray[np.float32]:
    mean = np.asarray(normalization.mean, np.float32)
    std = np.asarray(normalization.std, np.float32)
    scaled = (patches.astype(np.float32) / 255.0 - mean) / std
    return np.ascontiguousarray(scaled.transpose(0, 3, 1, 2))


def training_patches(lines: Iterable[str]) -> list[TrainingPatch]:
    patches = []
    for line in lines:
        fields = [field.strip() for field in line.split(",")]
        if len(fields) != 3 + LABELS_PER_ROW:
            continue
        slide, x, y, *labels = fields
        patches.append(TrainingPatch(slide, int(x), int(y), labels[CENTRE_LABEL] == "1"))
    return patches


def batched[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def patch_at(reader: RegionReader, x: int, y: int, side: int) -> Rgb:
    return resized(reader.read(x - side // 2, y - side // 2, side, side))


def embed_centres(
    reader: RegionReader,
    embedder: Embedder,
    centres: Sequence[tuple[int, int]],
    side: int,
    batch: int = DEFAULT_BATCH,
) -> Features:
    parts = [
        embedder.embed(np.stack([patch_at(reader, x, y, side) for x, y in chunk]))
        for chunk in batched(centres, batch)
    ]
    return np.concatenate(parts).astype(np.float32)


@dataclass(frozen=True)
class LinearProbe:
    weights: NDArray[np.float64]
    bias: float
    centre: NDArray[np.float64]
    scale: NDArray[np.float64]

    def probability(self, features: Features) -> NDArray[np.float32]:
        logits = ((features - self.centre) / self.scale) @ self.weights + self.bias
        return expit(logits).astype(np.float32)

    def save(self, path: Path) -> None:
        np.savez(path, weights=self.weights, bias=self.bias, centre=self.centre, scale=self.scale)

    @staticmethod
    def load(path: Path) -> LinearProbe:
        stored = np.load(path)
        return LinearProbe(
            stored["weights"], float(stored["bias"]), stored["centre"], stored["scale"]
        )


def fit_probe(
    features: Features, labels: NDArray[np.bool_], strength: float = DEFAULT_STRENGTH
) -> LinearProbe:
    if features.shape[0] != labels.shape[0]:
        raise ValueError(f"{features.shape[0]} feature rows for {labels.shape[0]} labels")
    if labels.all() or not labels.any():
        raise ValueError("A probe needs tumor and normal patches")
    values = features.astype(np.float64)
    centre = values.mean(axis=0)
    spread = values.std(axis=0)
    scale = np.where(spread > 0, spread, 1.0)
    standard = (values - centre) / scale
    signs = np.where(labels, 1.0, -1.0)

    def loss(parameters: NDArray[np.float64]) -> tuple[float, NDArray[np.float64]]:
        weights, bias = parameters[:-1], parameters[-1]
        margins = signs * (standard @ weights + bias)
        pull = -signs * expit(-margins)
        value = np.logaddexp(0.0, -margins).sum() + 0.5 * weights @ weights / strength
        gradient = np.append(standard.T @ pull + weights / strength, pull.sum())
        return float(value), gradient

    start = np.zeros(standard.shape[1] + 1)
    fitted = minimize(loss, start, jac=True, method="L-BFGS-B")
    return LinearProbe(fitted.x[:-1], float(fitted.x[-1]), centre, scale)


def block_centres(block: int) -> list[int]:
    first = MARGIN + CELL * block // 2
    return [first + index * CELL * block for index in range(TILE_CELLS // block)]


def context_margin(side: int, block: int) -> int:
    centres = block_centres(block)
    before = side // 2 - centres[0]
    after = centres[-1] - side // 2 + side - TILE_SIDE
    return max(0, before, after)


class WidenedReader:
    def __init__(self, reader: RegionReader, extra: int):
        self.reader = reader
        self.extra = extra

    def read(self, x: int, y: int, width: int, height: int) -> Rgb:
        extra = self.extra
        return self.reader.read(x - extra, y - extra, width + 2 * extra, height + 2 * extra)


class ProbeScorer:
    def __init__(
        self,
        embedder: Embedder,
        probe: LinearProbe,
        slide_spacing_um: float,
        block: int = DEFAULT_BLOCK,
        batch: int = DEFAULT_BATCH,
    ):
        if TILE_CELLS % block:
            raise ValueError(f"A block of {block} cells does not divide {TILE_CELLS}")
        self.embedder = embedder
        self.probe = probe
        self.block = block
        self.batch = batch
        self.side = read_side(slide_spacing_um)
        self.extra = context_margin(self.side, block)

    def crops(self, rgb: Rgb) -> list[Rgb]:
        expected = TILE_SIDE + 2 * self.extra
        if rgb.shape[:2] != (expected, expected):
            raise ValueError(f"The probe reads {expected} px tiles, got {rgb.shape[:2]}")
        starts = [self.extra + centre - self.side // 2 for centre in block_centres(self.block)]
        return [
            rgb[top : top + self.side, left : left + self.side] for top in starts for left in starts
        ]

    def score(self, rgb: Rgb) -> NDArray[np.floating[Any]]:
        crops = self.crops(rgb)
        features = np.concatenate(
            [
                self.embedder.embed(np.stack([resized(crop) for crop in chunk]))
                for chunk in batched(crops, self.batch)
            ]
        )
        count = TILE_CELLS // self.block
        grid = self.probe.probability(features).reshape(count, count)
        repeat = 2 * self.block
        return np.repeat(np.repeat(grid, repeat, axis=0), repeat, axis=1)


def probe_reader(reader: RegionReader, scorer: ProbeScorer) -> WidenedReader:
    return WidenedReader(reader, scorer.extra)


def tile_patch_count(block: int = DEFAULT_BLOCK) -> int:
    return (TILE_CELLS // block) ** 2
