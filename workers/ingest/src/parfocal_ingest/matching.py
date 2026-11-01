from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import shapely
from numpy.typing import NDArray
from scipy.spatial import KDTree
from shapely import STRtree
from shapely.geometry.base import BaseGeometry

REGION_IOU = 0.5
CELL_MICRONS = 4.0
CELL_PIXELS_WITHOUT_SCALE = 16.0


@dataclass(frozen=True)
class Known:
    number: int
    geometry: BaseGeometry


@dataclass(frozen=True)
class Matching:
    inherited: dict[int, int] = field(default_factory=dict[int, int])
    new: list[int] = field(default_factory=list[int])
    missing: list[int] = field(default_factory=list[int])

    def numbers(self, first_new: int) -> list[int]:
        count = len(self.inherited) + len(self.new)
        assigned = [0] * count
        for index, number in self.inherited.items():
            assigned[index] = number
        for offset, index in enumerate(self.new):
            assigned[index] = first_new + offset
        return assigned


def cell_distance(mpp: float | None, microns: float = CELL_MICRONS) -> float:
    return microns / mpp if mpp else CELL_PIXELS_WITHOUT_SCALE


def finish(
    pairs: list[tuple[float, int, int]],
    known: Sequence[Known],
    new_order: Sequence[tuple[float, float, int]],
) -> Matching:
    taken_known: set[int] = set()
    inherited: dict[int, int] = {}
    for _, known_index, incoming_index in sorted(pairs):
        if known_index in taken_known or incoming_index in inherited:
            continue
        taken_known.add(known_index)
        inherited[incoming_index] = known[known_index].number
    return Matching(
        inherited=inherited,
        new=[index for *_, index in sorted(new_order) if index not in inherited],
        missing=sorted(item.number for i, item in enumerate(known) if i not in taken_known),
    )


def match_regions(
    known: Sequence[Known], incoming: Sequence[BaseGeometry], threshold: float = REGION_IOU
) -> Matching:
    pairs: list[tuple[float, int, int]] = []
    if known and incoming:
        tree = STRtree([item.geometry for item in known])
        incoming_indexes, known_indexes = tree.query(list(incoming), predicate="intersects")
        for incoming_index, known_index in zip(
            incoming_indexes.tolist(), known_indexes.tolist(), strict=True
        ):
            first, second = incoming[incoming_index], known[known_index].geometry
            union = shapely.union(first, second).area
            iou = shapely.intersection(first, second).area / union if union else 0.0
            if iou >= threshold:
                pairs.append((-iou, known_index, incoming_index))
    largest_first = [(-geometry.area, 0.0, index) for index, geometry in enumerate(incoming)]
    return finish(pairs, known, largest_first)


def reading_order(xy: NDArray[np.float64]) -> list[int]:
    if not len(xy):
        return []
    return np.lexsort((np.arange(len(xy)), xy[:, 0], xy[:, 1])).tolist()


def match_centres(
    known_numbers: NDArray[np.integer[Any]],
    known_xy: NDArray[np.float64],
    incoming_xy: NDArray[np.float64],
    distance: float,
) -> Matching:
    inherited: dict[int, int] = {}
    taken = bytearray(len(known_numbers))
    if len(known_numbers) and len(incoming_xy):
        pairs = KDTree(known_xy).sparse_distance_matrix(
            KDTree(incoming_xy), distance, output_type="ndarray"
        )
        order = np.lexsort((pairs["j"], pairs["i"], pairs["v"]))
        numbers = known_numbers.tolist()
        for known_index, incoming_index in zip(
            pairs["i"][order].tolist(), pairs["j"][order].tolist(), strict=True
        ):
            if taken[known_index] or incoming_index in inherited:
                continue
            taken[known_index] = 1
            inherited[incoming_index] = numbers[known_index]
    pairs_left = zip(known_numbers.tolist(), taken, strict=True)
    return Matching(
        inherited=inherited,
        new=[index for index in reading_order(incoming_xy) if index not in inherited],
        missing=sorted(int(number) for number, used in pairs_left if not used),
    )


def centres(geometries: Sequence[BaseGeometry]) -> NDArray[np.float64]:
    points = [geometry.centroid for geometry in geometries]
    return np.array([[point.x, point.y] for point in points], dtype=np.float64).reshape(-1, 2)


def match_cells(
    known: Sequence[Known], incoming: Sequence[BaseGeometry], distance: float
) -> Matching:
    numbers = np.array([item.number for item in known], dtype=np.int64)
    return match_centres(
        numbers, centres([item.geometry for item in known]), centres(incoming), distance
    )
