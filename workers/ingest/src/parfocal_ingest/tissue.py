import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFilter
from scipy import ndimage

from parfocal_ingest.identify import Format
from parfocal_ingest.pyramid import Pyramid
from parfocal_ingest.thumbnail import region_for

CELL = 64
MIN_SATURATION = 20
MARGIN_CELLS = 1
SPECK_SHARE = 0.001


@dataclass(frozen=True)
class TissueBox:
    x: int
    y: int
    width: int
    height: int

    def facts(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


@dataclass(frozen=True)
class TissueMask:
    cell: int
    threshold: int
    cells: NDArray[np.bool_]
    box: TissueBox | None

    @property
    def fraction(self) -> float:
        return float(self.cells.mean())

    def png(self) -> bytes:
        buffer = io.BytesIO()
        Image.fromarray(self.cells).save(buffer, "PNG", optimize=True)
        return buffer.getvalue()


def otsu(values: NDArray[np.uint8]) -> int:
    histogram = np.bincount(values.ravel(), minlength=256).astype(np.float64)
    weight = np.cumsum(histogram) / histogram.sum()
    mean = np.cumsum(histogram * np.arange(256)) / histogram.sum()
    between = (mean[-1] * weight - mean) ** 2 / np.maximum(weight * (1 - weight), 1e-12)
    return int(np.argmax(between))


def mask_of(image: Image.Image) -> tuple[int, NDArray[np.bool_]]:
    saturation = np.asarray(image.convert("HSV"))[..., 1]
    threshold = max(otsu(saturation), MIN_SATURATION)
    tissue = Image.fromarray(saturation > threshold)
    grown = tissue.convert("L").filter(ImageFilter.MaxFilter(2 * MARGIN_CELLS + 1))
    return threshold, np.asarray(grown) > 0


def without_specks(cells: NDArray[np.bool_]) -> NDArray[np.bool_]:
    labels, count = cast(tuple[NDArray[np.int32], int], ndimage.label(cells, np.ones((3, 3))))
    if count == 0:
        return cells
    sizes = np.bincount(labels.ravel())[1:]
    kept = np.flatnonzero(sizes >= SPECK_SHARE * sizes.sum()) + 1
    if kept.size == 0:
        return cells
    return np.isin(labels, kept)


def box_of(cells: NDArray[np.bool_], cell: int, width: int, height: int) -> TissueBox | None:
    kept = without_specks(cells)
    rows = np.flatnonzero(kept.any(axis=1))
    cols = np.flatnonzero(kept.any(axis=0))
    if rows.size == 0:
        return None
    left, top = int(cols[0]) * cell, int(rows[0]) * cell
    right = min((int(cols[-1]) + 1) * cell, width)
    bottom = min((int(rows[-1]) + 1) * cell, height)
    return TissueBox(left, top, right - left, bottom - top)


def tissue_mask(path: Path, found: Format, pyramid: Pyramid, cell: int = CELL) -> TissueMask:
    base = pyramid.levels[0]
    grid = (math.ceil(base.width / cell), math.ceil(base.height / cell))
    image = region_for(path, found, pyramid, max(grid)).resize(grid, Image.Resampling.BOX)
    threshold, cells = mask_of(image)
    return TissueMask(cell, threshold, cells, box_of(cells, cell, base.width, base.height))
