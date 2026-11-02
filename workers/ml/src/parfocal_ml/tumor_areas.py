import tomllib
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from importlib.resources import files
from typing import cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

OUTLINE_AT = 0.5
LISTED_FROM_PEAK = 0.97
MICRO_LINE_MM = 0.2
MACRO_LINE_MM = 2.0
MICRO_TUMOR_CELLS = 200
SIZABLE_CELLS = 2

type Point = tuple[float, float]
type Extent = tuple[float, float, float, float]
type Grid = NDArray[np.floating]


class Category(StrEnum):
    MACRO = "macro"
    MICRO = "micro"
    ITC = "itc"


@dataclass(frozen=True)
class LikelySize:
    below: float
    above: float
    source: str

    def around(self, longest_mm: float) -> tuple[float, float]:
        return longest_mm * (1 - self.below), longest_mm * (1 + self.above)


@dataclass(frozen=True)
class TumorArea:
    cells: int
    peak: float
    box: Extent
    centre: Point
    area_mm2: float
    longest_mm: float
    likely_mm: tuple[float, float]
    category: Category
    near_line: bool
    too_small_for_map: bool


@cache
def likely_size() -> LikelySize:
    config = tomllib.loads(files(__package__).joinpath("tumor_areas.toml").read_text())
    section = config["likely_size"]
    return LikelySize(float(section["below"]), float(section["above"]), str(section["source"]))


def category_of(longest_mm: float, tumor_cells: int | None = None) -> Category:
    if longest_mm > MACRO_LINE_MM:
        return Category.MACRO
    if longest_mm > MICRO_LINE_MM or (tumor_cells or 0) > MICRO_TUMOR_CELLS:
        return Category.MICRO
    return Category.ITC


def crosses_a_line(likely_mm: tuple[float, float]) -> bool:
    low, high = likely_mm
    return any(low <= line < high for line in (MICRO_LINE_MM, MACRO_LINE_MM))


def convex_hull(points: list[Point]) -> list[Point]:
    ordered = sorted(set(points))
    if len(ordered) < 3:
        return ordered

    def turn(o: Point, a: Point, b: Point) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def chain(sequence: list[Point]) -> list[Point]:
        kept: list[Point] = []
        for point in sequence:
            while len(kept) >= 2 and turn(kept[-2], kept[-1], point) <= 0:
                kept.pop()
            kept.append(point)
        return kept[:-1]

    return chain(ordered) + chain(ordered[::-1])


def diameter(points: list[Point]) -> float:
    if len(points) < 2:
        return 0.0
    array = np.asarray(points, dtype=np.float64)
    gaps = array[:, None, :] - array[None, :, :]
    return float(np.sqrt((gaps**2).sum(axis=-1)).max())


def cell_corners(
    rows: NDArray[np.integer], cols: NDArray[np.integer], cell_w: float, cell_h: float
) -> list[Point]:
    xs = np.concatenate([cols, cols + 1, cols, cols + 1]) * cell_w
    ys = np.concatenate([rows, rows, rows + 1, rows + 1]) * cell_h
    return list(zip(xs.tolist(), ys.tolist(), strict=True))


def find_tumor_areas(
    grid: Grid,
    extent: Extent,
    um_per_px: float,
    *,
    outline_at: float = OUTLINE_AT,
    listed_from_peak: float = LISTED_FROM_PEAK,
    size: LikelySize | None = None,
) -> list[TumorArea]:
    size = size or likely_size()
    values = np.asarray(grid, dtype=np.float64)
    height, width = values.shape
    cell_w = (extent[2] - extent[0]) / width
    cell_h = (extent[3] - extent[1]) / height
    cell_um = max(cell_w, cell_h) * um_per_px
    labels = np.zeros(values.shape, dtype=np.int32)
    count = cast(
        int,
        ndimage.label(values >= outline_at, structure=np.ones((3, 3), dtype=bool), output=labels),
    )
    if count == 0:
        return []
    peaks = ndimage.maximum(values, labels, index=np.arange(1, count + 1))
    areas: list[TumorArea] = []
    for label, region in enumerate(ndimage.find_objects(labels), start=1):
        peak = float(peaks[label - 1])
        if region is None or peak < listed_from_peak:
            continue
        rows, cols = np.nonzero(labels[region] == label)
        rows = rows + region[0].start
        cols = cols + region[1].start
        longest_mm = (
            diameter(convex_hull(cell_corners(rows, cols, cell_w, cell_h))) * um_per_px / 1000
        )
        likely = size.around(longest_mm)
        areas.append(
            TumorArea(
                cells=int(rows.size),
                peak=peak,
                box=(
                    extent[0] + int(cols.min()) * cell_w,
                    extent[1] + int(rows.min()) * cell_h,
                    extent[0] + (int(cols.max()) + 1) * cell_w,
                    extent[1] + (int(rows.max()) + 1) * cell_h,
                ),
                centre=(
                    extent[0] + float(cols.mean() + 0.5) * cell_w,
                    extent[1] + float(rows.mean() + 0.5) * cell_h,
                ),
                area_mm2=rows.size * cell_w * cell_h * um_per_px**2 / 1e6,
                longest_mm=longest_mm,
                likely_mm=likely,
                category=category_of(longest_mm),
                near_line=crosses_a_line(likely),
                too_small_for_map=longest_mm * 1000 < SIZABLE_CELLS * cell_um,
            )
        )
    return sorted(areas, key=lambda area: (-area.longest_mm, -area.peak))


@dataclass(frozen=True)
class DepositMatch:
    truth_mm: float
    found_mm: float | None
    areas: int

    @property
    def error_mm(self) -> float | None:
        return None if self.found_mm is None else self.found_mm - self.truth_mm


@dataclass(frozen=True)
class AreaEvaluation:
    deposits: list[DepositMatch]
    stray: list[TumorArea]


def outline_mm(vertices: list[Point], um_per_px: float) -> float:
    return diameter(convex_hull(vertices)) * um_per_px / 1000


def bounds(vertices: list[Point]) -> Extent:
    xs = [x for x, _ in vertices]
    ys = [y for _, y in vertices]
    return min(xs), min(ys), max(xs), max(ys)


def overlaps(a: Extent, b: Extent, pad: float) -> bool:
    return a[0] - pad < b[2] and b[0] - pad < a[2] and a[1] - pad < b[3] and b[1] - pad < a[3]


def evaluate_areas(
    areas: list[TumorArea], outlines: list[list[Point]], um_per_px: float, pad: float
) -> AreaEvaluation:
    used: set[int] = set()
    deposits: list[DepositMatch] = []
    for vertices in sorted(outlines, key=lambda outline: -outline_mm(outline, um_per_px)):
        box = bounds(vertices)
        hits = [index for index, area in enumerate(areas) if overlaps(area.box, box, pad)]
        used.update(hits)
        found = max((areas[index].longest_mm for index in hits), default=None)
        deposits.append(DepositMatch(outline_mm(vertices, um_per_px), found, len(hits)))
    return AreaEvaluation(deposits, [area for index, area in enumerate(areas) if index not in used])
