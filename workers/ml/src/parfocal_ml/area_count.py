from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from parfocal_common.node_staging import Cell, Range, count_is_firm, count_of
from parfocal_ml.cell_areas import TUMOR, TypedCell
from parfocal_ml.tumor_areas import MICRO_LINE_MM, Extent, Point, TumorArea
from parfocal_ml.tumor_map import CELL as FINE_MAP_CELL_PX
from parfocal_ml.type_evaluation import scaled


class MapTooCoarseError(ValueError):
    pass


class UntypedNucleusError(ValueError):
    pass


@dataclass(frozen=True)
class AreaCount:
    members: tuple[int, ...]
    cells: tuple[Cell, ...]
    tumor_calls: int
    count: Range

    @property
    def nuclei(self) -> int:
        return len(self.members)

    @property
    def firm(self) -> bool:
        return count_is_firm(self.count)


def inside_outline(
    outline: Sequence[Point], xs: NDArray[np.float64], ys: NDArray[np.float64]
) -> NDArray[np.bool_]:
    inside = np.zeros(xs.shape, dtype=bool)
    if len(outline) < 3:
        return inside
    for (ax, ay), (bx, by) in zip(outline, [*outline[1:], outline[0]], strict=True):
        if ay == by:
            continue
        spans = (ay > ys) != (by > ys)
        crossing = ax + (ys - ay) * (bx - ax) / (by - ay)
        inside ^= spans & (xs < crossing)
    return inside


def tumor_probability(cell: TypedCell, temperature: float, kind: str) -> float:
    if kind not in cell.probabilities:
        raise UntypedNucleusError(f"nucleus at {cell.x}, {cell.y} has no {kind} probability")
    names = list(cell.probabilities)
    values = np.array([cell.probabilities[name] for name in names], dtype=np.float64)
    return float(scaled(values[None, :], temperature)[0, names.index(kind)])


def count_members(
    cells: Sequence[TypedCell],
    members: NDArray[np.intp],
    *,
    temperature: float = 1.0,
    reviewed: Mapping[int, bool] | None = None,
    kind: str = TUMOR,
) -> AreaCount:
    reviewed = reviewed or {}
    staged = tuple(
        Cell(
            tumor_probability=tumor_probability(cells[index], temperature, kind),
            called_tumor=cells[index].type == kind,
            checked=reviewed.get(index),
        )
        for index in members.tolist()
    )
    return AreaCount(
        members=tuple(members.tolist()),
        cells=staged,
        tumor_calls=sum(cell.called_tumor for cell in staged),
        count=count_of(staged),
    )


def positions(cells: Sequence[TypedCell]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    xs = np.array([cell.x for cell in cells], dtype=np.float64)
    ys = np.array([cell.y for cell in cells], dtype=np.float64)
    return xs, ys


def count_in_outline(
    cells: Sequence[TypedCell],
    outline: Sequence[Point],
    *,
    temperature: float = 1.0,
    reviewed: Mapping[int, bool] | None = None,
    kind: str = TUMOR,
) -> AreaCount:
    xs, ys = positions(cells)
    members = np.flatnonzero(inside_outline(outline, xs, ys))
    return count_members(cells, members, temperature=temperature, reviewed=reviewed, kind=kind)


def map_cell_px(labels: NDArray[np.integer], extent: Extent) -> float:
    height, width = labels.shape
    return max((extent[2] - extent[0]) / width, (extent[3] - extent[1]) / height)


def count_in_map_area(
    cells: Sequence[TypedCell],
    area: TumorArea,
    labels: NDArray[np.integer],
    extent: Extent,
    *,
    temperature: float = 1.0,
    reviewed: Mapping[int, bool] | None = None,
    kind: str = TUMOR,
) -> AreaCount:
    cell_px = map_cell_px(labels, extent)
    if area.longest_mm <= MICRO_LINE_MM and cell_px > FINE_MAP_CELL_PX + 0.5:
        raise MapTooCoarseError(
            f"a {area.longest_mm:.3f} mm area needs the {FINE_MAP_CELL_PX} px map, "
            f"not cells of {cell_px:.0f} px"
        )
    height, width = labels.shape
    xs, ys = positions(cells)
    cols = np.floor((xs - extent[0]) / ((extent[2] - extent[0]) / width)).astype(np.intp)
    rows = np.floor((ys - extent[1]) / ((extent[3] - extent[1]) / height)).astype(np.intp)
    on_map = (cols >= 0) & (cols < width) & (rows >= 0) & (rows < height)
    hit = np.zeros(xs.shape, dtype=bool)
    hit[on_map] = labels[rows[on_map], cols[on_map]] == area.label
    members = np.flatnonzero(hit)
    return count_members(cells, members, temperature=temperature, reviewed=reviewed, kind=kind)
