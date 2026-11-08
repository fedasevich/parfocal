import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import KDTree

from parfocal_ml.tumor_areas import (
    Category,
    Extent,
    LikelySize,
    Point,
    category_of,
    convex_hull,
    crosses_a_line,
    diameter,
    likely_size,
)

LINK_UM = 20.0
MIN_AREA_CELLS = 3
TUMOR = "tumor"


@dataclass(frozen=True)
class TypedCell:
    x: float
    y: float
    type: str
    probabilities: Mapping[str, float] = field(default_factory=dict[str, float])
    diagonal: float = 0.0


@dataclass(frozen=True)
class CellArea:
    kind: str
    members: tuple[int, ...]
    typed_cells: int
    expected_cells: float
    other_cells: int
    outline: tuple[Point, ...]
    box: Extent
    centre: Point
    area_mm2: float
    longest_mm: float
    likely_mm: tuple[float, float]
    category: Category | None
    near_line: bool

    @property
    def share(self) -> float:
        return self.typed_cells / (self.typed_cells + self.other_cells)


def linked_groups(
    xs: NDArray[np.float64], ys: NDArray[np.float64], link: float
) -> list[NDArray[np.intp]]:
    count = xs.size
    if count == 0:
        return []
    pairs = KDTree(np.column_stack([xs, ys])).query_pairs(link, output_type="ndarray")
    graph = coo_matrix(
        (np.ones(len(pairs), dtype=np.int8), (pairs[:, 0], pairs[:, 1])), shape=(count, count)
    )
    _, labels = connected_components(graph, directed=False)
    order = np.argsort(labels, kind="stable")
    breaks = np.flatnonzero(np.diff(labels[order])) + 1
    return np.split(order, breaks)


def polygon_area(outline: Sequence[Point]) -> float:
    if len(outline) < 3:
        return 0.0
    xs = np.array([x for x, _ in outline])
    ys = np.array([y for _, y in outline])
    return float(abs(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))) / 2)


def perimeter(outline: Sequence[Point]) -> float:
    if len(outline) < 2:
        return 0.0
    return sum(math.dist(a, b) for a, b in zip(outline, [*outline[1:], outline[0]], strict=True))


def inside_hull(
    outline: Sequence[Point], xs: NDArray[np.float64], ys: NDArray[np.float64]
) -> NDArray[np.bool_]:
    if len(outline) < 3:
        return np.zeros(xs.shape, dtype=bool)
    inside = np.ones(xs.shape, dtype=bool)
    for (ax, ay), (bx, by) in zip(outline, [*outline[1:], outline[0]], strict=True):
        inside &= (bx - ax) * (ys - ay) - (by - ay) * (xs - ax) >= 0
    return inside


def find_cell_areas(
    cells: Sequence[TypedCell],
    um_per_px: float,
    *,
    kind: str = TUMOR,
    link_um: float = LINK_UM,
    min_cells: int = MIN_AREA_CELLS,
    size: LikelySize | None = None,
) -> list[CellArea]:
    size = size or likely_size()
    xs = np.array([cell.x for cell in cells], dtype=np.float64)
    ys = np.array([cell.y for cell in cells], dtype=np.float64)
    of_kind = np.array([cell.type == kind for cell in cells], dtype=bool)
    chosen = np.flatnonzero(of_kind)
    others = np.flatnonzero(~of_kind)
    other_order = others[np.argsort(xs[others], kind="stable")]
    other_xs = xs[other_order]
    areas: list[CellArea] = []
    for group in linked_groups(xs[chosen], ys[chosen], link_um / um_per_px):
        if group.size < min_cells:
            continue
        members = np.sort(chosen[group])
        points: list[Point] = list(zip(xs[members].tolist(), ys[members].tolist(), strict=True))
        outline = tuple(convex_hull(points))
        pad = float(np.median([cells[index].diagonal for index in members])) / 2
        low = int(np.searchsorted(other_xs, xs[members].min(), side="left"))
        high = int(np.searchsorted(other_xs, xs[members].max(), side="right"))
        nearby = other_order[low:high]
        other_cells = int(inside_hull(outline, xs[nearby], ys[nearby]).sum())
        longest_mm = (diameter(list(outline)) + 2 * pad) * um_per_px / 1000
        area_px = polygon_area(outline) + perimeter(outline) * pad + math.pi * pad**2
        likely = size.around(longest_mm)
        areas.append(
            CellArea(
                kind=kind,
                members=tuple(members.tolist()),
                typed_cells=int(members.size),
                expected_cells=float(
                    sum(cells[index].probabilities.get(kind, 1.0) for index in members)
                ),
                other_cells=other_cells,
                outline=outline,
                box=(
                    float(xs[members].min()) - pad,
                    float(ys[members].min()) - pad,
                    float(xs[members].max()) + pad,
                    float(ys[members].max()) + pad,
                ),
                centre=(float(xs[members].mean()), float(ys[members].mean())),
                area_mm2=area_px * um_per_px**2 / 1e6,
                longest_mm=longest_mm,
                likely_mm=likely,
                category=category_of(longest_mm, int(members.size)) if kind == TUMOR else None,
                near_line=crosses_a_line(likely),
            )
        )
    return sorted(areas, key=lambda area: (-area.typed_cells, area.centre))
