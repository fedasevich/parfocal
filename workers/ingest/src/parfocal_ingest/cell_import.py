from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely
from numpy.typing import NDArray
from shapely import STRtree
from shapely.geometry.base import BaseGeometry

POINT = 0
POLYGON = 3


@dataclass(frozen=True)
class Outlines:
    rings: list[list[float]]
    centres: NDArray[np.float64]


def largest_polygon(geometry: BaseGeometry) -> BaseGeometry:
    parts = [part for part in shapely.get_parts(geometry) if part.geom_type == "Polygon"]
    if not parts:
        return shapely.point_on_surface(geometry)
    return max(parts, key=lambda part: part.area)


def outline_shapes(geometries: Sequence[BaseGeometry]) -> NDArray[Any]:
    shapes = np.empty(len(geometries), dtype=object)
    shapes[:] = list(geometries)
    kinds = shapely.get_type_id(shapes)
    for index in np.flatnonzero((kinds != POINT) & (kinds != POLYGON)).tolist():
        shapes[index] = largest_polygon(shapes[index])
    polygons = shapely.get_type_id(shapes) == POLYGON
    shapes[polygons] = shapely.get_exterior_ring(shapes[polygons])
    return shapes


def outlines(geometries: Sequence[BaseGeometry]) -> Outlines:
    if not geometries:
        return Outlines([], np.zeros((0, 2), dtype=np.float64))
    shapes = outline_shapes(geometries)
    coords, owners = shapely.get_coordinates(shapes, return_index=True)
    counts = np.bincount(owners, minlength=len(shapes))
    ends = np.cumsum(counts)
    starts = ends - counts
    closed = (counts > 1) & np.all(coords[ends - 1] == coords[starts], axis=1)
    keep = np.ones(len(coords), dtype=bool)
    keep[(ends - 1)[closed]] = False
    kept = coords[keep].astype(np.float32).astype(np.float64)
    lengths = counts - closed
    bounds = np.concatenate(([0], np.cumsum(lengths)))
    sums = np.add.reduceat(kept, bounds[:-1], axis=0)
    centres = sums / lengths[:, None]
    flat = kept.ravel().tolist()
    edges = (bounds * 2).tolist()
    rings = [flat[edges[index] : edges[index + 1]] for index in range(len(geometries))]
    return Outlines(rings, centres)


def innermost_regions(
    centres: NDArray[np.float64], regions: Sequence[tuple[int, BaseGeometry]]
) -> NDArray[np.uint32]:
    found = np.zeros(len(centres), dtype=np.uint32)
    if not regions or not len(centres):
        return found
    tree = STRtree([geometry for _, geometry in regions])
    point_indexes, region_indexes = tree.query(shapely.points(centres), predicate="intersects")
    if not len(point_indexes):
        return found
    areas = np.array([geometry.area for _, geometry in regions], dtype=np.float64)
    numbers = np.array([number for number, _ in regions], dtype=np.uint32)
    order = np.lexsort((numbers[region_indexes], areas[region_indexes], point_indexes))
    _, first = np.unique(point_indexes[order], return_index=True)
    chosen = order[first]
    found[point_indexes[chosen]] = numbers[region_indexes[chosen]]
    return found


def latest_per_number(
    numbers: NDArray[np.int64], centres: NDArray[np.float64]
) -> tuple[NDArray[np.int64], NDArray[np.float64]]:
    if not len(numbers):
        return numbers, centres
    reversed_numbers = numbers[::-1]
    _, last = np.unique(reversed_numbers, return_index=True)
    picked = len(numbers) - 1 - last
    return numbers[picked], centres[picked]
