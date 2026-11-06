import asyncio
import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage
from skimage.measure import approximate_polygon, find_contours
from skimage.segmentation import watershed

from parfocal_common.cell_chunks import UNCLASSIFIED
from parfocal_common.chunk_store import Cell
from parfocal_ml.sam_contract import GRAPHS, IMAGE_SIZE, onnx_dir, pixel_values, resized_shape
from parfocal_ml.whole_slide import Window

WINDOW_PX = 512
WINDOW_HALO_PX = 64

type Maps = NDArray[np.float32]
type Rgb = NDArray[np.uint8]
type Labels = NDArray[np.int32]


class Quality(Enum):
    BEST = 0.25
    FAST = 0.33

    @property
    def mpp(self) -> float:
        return self.value


@dataclass(frozen=True)
class AisOptions:
    foreground_threshold: float = 0.5
    center_threshold: float = 0.5
    boundary_threshold: float = 0.5
    foreground_smoothing: float = 1.0
    distance_smoothing: float = 1.6
    min_area: int = 20
    outline_smoothing: float = 1.0
    simplify_px: float = 0.25


DEFAULT_OPTIONS = AisOptions()


class MapModel(Protocol):
    def maps(self, rgb: Rgb) -> Maps: ...


class RegionReader(Protocol):
    mpp: float

    async def read(self, window: Window, width: int, height: int) -> Rgb: ...


@dataclass(frozen=True)
class Outline:
    ring: NDArray[np.float64]
    area: int
    confidence: float

    @property
    def centre(self) -> tuple[float, float]:
        return float(self.ring[:, 0].mean()), float(self.ring[:, 1].mean())


def window_starts(length: int, core: int) -> range:
    return range(0, length, core)


def stitched_maps(
    rgb: Rgb, model: MapModel, core: int = WINDOW_PX, halo: int = WINDOW_HALO_PX
) -> Maps:
    height, width = rgb.shape[:2]
    if height <= core + 2 * halo and width <= core + 2 * halo:
        return model.maps(rgb)
    out = np.zeros((3, height, width), np.float32)
    for y0 in window_starts(height, core):
        for x0 in window_starts(width, core):
            y1, x1 = min(height, y0 + core), min(width, x0 + core)
            top, left = max(0, y0 - halo), max(0, x0 - halo)
            bottom, right = min(height, y1 + halo), min(width, x1 + halo)
            part = model.maps(rgb[top:bottom, left:right])
            out[:, y0:y1, x0:x1] = part[:, y0 - top : y1 - top, x0 - left : x1 - left]
    return out


def instances(maps: Maps, options: AisOptions = DEFAULT_OPTIONS) -> tuple[Labels, Maps]:
    foreground = ndimage.gaussian_filter(maps[0], options.foreground_smoothing)
    center = ndimage.gaussian_filter(maps[1], options.distance_smoothing)
    boundary = ndimage.gaussian_filter(maps[2], options.distance_smoothing)
    mask = foreground > options.foreground_threshold
    seeds = (center < options.center_threshold) & (boundary < options.boundary_threshold) & mask
    markers = np.zeros(seeds.shape, np.int32)
    ndimage.label(seeds, output=markers)
    labels = watershed(boundary, markers=markers, mask=mask)
    return labels.astype(np.int32), foreground.astype(np.float32)


def outline_of(field: NDArray[np.float64], simplify_px: float) -> NDArray[np.float64] | None:
    contours = [c for c in find_contours(field, 0.5) if len(c) >= 4]
    if not contours:
        return None
    longest = max(contours, key=len)
    ring = approximate_polygon(longest, simplify_px)
    if len(ring) > 1 and np.array_equal(ring[0], ring[-1]):
        ring = ring[:-1]
    if len(ring) < 3:
        return None
    return ring[:, ::-1]


def traced(
    labels: Labels, foreground: Maps, options: AisOptions = DEFAULT_OPTIONS
) -> list[Outline]:
    pad = math.ceil(3 * options.outline_smoothing) + 1
    outlines: list[Outline] = []
    for label, found in enumerate(ndimage.find_objects(labels), start=1):
        if found is None:
            continue
        rows, columns = found
        inside = labels[found] == label
        area = int(inside.sum())
        if area < options.min_area:
            continue
        field = np.pad(inside.astype(np.float64), pad)
        if options.outline_smoothing > 0:
            field = ndimage.gaussian_filter(field, options.outline_smoothing)
        ring = outline_of(field, options.simplify_px)
        if ring is None:
            continue
        ring = ring + np.array([columns.start - pad, rows.start - pad])
        confidence = float(foreground[found][inside].mean())
        outlines.append(Outline(ring, area, confidence))
    return outlines


def detect_outlines(
    rgb: Rgb, model: MapModel, options: AisOptions = DEFAULT_OPTIONS
) -> list[Outline]:
    labels, foreground = instances(stitched_maps(rgb, model), options)
    return traced(labels, foreground, options)


def model_size(window: Window, scale: float) -> tuple[int, int]:
    return max(1, round(window.width * scale)), max(1, round(window.height * scale))


def to_slide(outline: Outline, window: Window, scale_x: float, scale_y: float) -> list[float]:
    xs = (outline.ring[:, 0] + 0.5) / scale_x - 0.5 + window.x
    ys = (outline.ring[:, 1] + 0.5) / scale_y - 0.5 + window.y
    return np.column_stack([xs, ys]).ravel().round(3).tolist()


def as_cell(outline: Outline, window: Window, scale_x: float, scale_y: float) -> Cell:
    score = min(255, max(0, round(outline.confidence * 255)))
    return Cell(0, to_slide(outline, window, scale_x, scale_y), UNCLASSIFIED, score)


@dataclass
class PathoSamDetector:
    reader: RegionReader
    model: MapModel
    quality: Quality = Quality.BEST
    options: AisOptions = DEFAULT_OPTIONS
    classes: int = 1

    async def detect(self, window: Window) -> Sequence[Cell]:
        width, height = model_size(window, self.reader.mpp / self.quality.mpp)
        rgb = await self.reader.read(window, width, height)
        outlines = await asyncio.to_thread(detect_outlines, rgb, self.model, self.options)
        scale_x, scale_y = width / window.width, height / window.height
        return [as_cell(outline, window, scale_x, scale_y) for outline in outlines]


def half_pixel_resize(planes: Maps, height: int, width: int) -> Maps:
    def axis(source: int, target: int) -> tuple[NDArray[np.intp], NDArray[np.intp], Maps]:
        position = (np.arange(target, dtype=np.float32) + 0.5) * (source / target) - 0.5
        position = np.clip(position, 0, source - 1)
        low = np.floor(position).astype(np.intp)
        high = np.minimum(low + 1, source - 1)
        return low, high, (position - low).astype(np.float32)

    top, bottom, wy = axis(planes.shape[1], height)
    left, right, wx = axis(planes.shape[2], width)
    rows = planes[:, top, :] * (1 - wy)[None, :, None] + planes[:, bottom, :] * wy[None, :, None]
    return (rows[:, :, left] * (1 - wx) + rows[:, :, right] * wx).astype(np.float32)


def encoder_input(rgb: Rgb) -> tuple[NDArray[np.float32], int, int]:
    resized_h, resized_w = resized_shape(*rgb.shape[:2])
    return pixel_values(np.ascontiguousarray(rgb)), resized_h, resized_w


def weights_dir(folder: Path | None = None) -> Path | None:
    chosen = folder or onnx_dir()
    needed = (GRAPHS.encoder, GRAPHS.ais_decoder_full)
    return chosen if all((chosen / name).is_file() for name in needed) else None


class WeightsError(RuntimeError):
    pass


class OnnxPathoSam:
    def __init__(self, folder: Path, providers: Sequence[str] | None = None) -> None:
        import onnxruntime as ort

        chosen = list(providers) if providers else default_providers(ort.get_available_providers())
        self.encoder: Any = ort.InferenceSession(str(folder / GRAPHS.encoder), providers=chosen)
        self.decoder: Any = ort.InferenceSession(
            str(folder / GRAPHS.ais_decoder_full), providers=chosen
        )
        side = self.decoder.get_outputs()[0].shape[-1]
        if side != IMAGE_SIZE:
            raise WeightsError(
                f"{GRAPHS.ais_decoder_full} gives {side} px maps, and the runner needs the full "
                f"{IMAGE_SIZE} px decoder export without pooling"
            )

    def maps(self, rgb: Rgb) -> Maps:
        height, width = rgb.shape[:2]
        tensor, resized_h, resized_w = encoder_input(rgb)
        (embedding,) = self.encoder.run(None, {self.encoder.get_inputs()[0].name: tensor})
        (raw,) = self.decoder.run(None, {self.decoder.get_inputs()[0].name: embedding})
        full = raw[0].astype(np.float32)
        return half_pixel_resize(full[:, :resized_h, :resized_w], height, width)


def default_providers(available: Sequence[str]) -> list[str]:
    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
