import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFilter

from parfocal_ingest.identify import Format
from parfocal_ingest.pyramid import Pyramid
from parfocal_ingest.thumbnail import region_for

CELL = 64
MIN_SATURATION = 20
MARGIN_CELLS = 1


@dataclass(frozen=True)
class TissueMask:
    cell: int
    threshold: int
    cells: NDArray[np.bool_]

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


def tissue_mask(path: Path, found: Format, pyramid: Pyramid, cell: int = CELL) -> TissueMask:
    base = pyramid.levels[0]
    grid = (math.ceil(base.width / cell), math.ceil(base.height / cell))
    image = region_for(path, found, pyramid, max(grid)).resize(grid, Image.Resampling.BOX)
    threshold, cells = mask_of(image)
    return TissueMask(cell, threshold, cells)
