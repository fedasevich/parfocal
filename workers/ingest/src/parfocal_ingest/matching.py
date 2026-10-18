from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import shapely
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


def match_cells(
    known: Sequence[Known], incoming: Sequence[BaseGeometry], distance: float
) -> Matching:
    pairs: list[tuple[float, int, int]] = []
    if known and incoming:
        before = np.array([[p.x, p.y] for p in (item.geometry.centroid for item in known)])
        after = np.array([[p.x, p.y] for p in (geometry.centroid for geometry in incoming)])
        tree = KDTree(before)
        for incoming_index, neighbours in enumerate(tree.query_ball_point(after, r=distance)):
            for known_index in neighbours:
                gap = float(np.hypot(*(after[incoming_index] - before[known_index])))
                pairs.append((gap, known_index, incoming_index))
    reading = [
        (point.y, point.x, index)
        for index, point in enumerate(geometry.centroid for geometry in incoming)
    ]
    return finish(pairs, known, reading)
