import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Self

import numpy as np
import shapely
from numpy.typing import NDArray
from shapely import STRtree
from shapely.geometry.base import BaseGeometry

from parfocal_ingest.chunk_builder import centres_of
from parfocal_ingest.results import ResultObject

POINT = 0
POLYGON = 3
NAME_LENGTH = 120
SCORE_SCALE = 255
NO_CLASS = -1
MAX_NAMES = 255
REGION_QUERY_CELLS = 200_000


def class_key(name: str | None) -> str | None:
    cleaned = (name or "").strip()[:NAME_LENGTH]
    return cleaned.casefold() if cleaned else None


def scaled(value: float | None) -> int | None:
    if value is None:
        return None
    return max(0, min(SCORE_SCALE, round(value * SCORE_SCALE)))


def scaled_all(values: NDArray[np.float64]) -> NDArray[np.uint8]:
    return np.clip(np.rint(values * SCORE_SCALE), 0, SCORE_SCALE).astype(np.uint8)


@dataclass(frozen=True)
class Outlines:
    points: NDArray[np.float32]
    offsets: NDArray[np.int64]
    centres: NDArray[np.float64]

    def __len__(self) -> int:
        return len(self.offsets) - 1

    def ring(self, index: int) -> list[float]:
        start, end = int(self.offsets[index]), int(self.offsets[index + 1])
        return self.points[2 * start : 2 * end].astype(np.float64).tolist()

    @property
    def rings(self) -> list[list[float]]:
        return [self.ring(index) for index in range(len(self))]


def no_outlines() -> Outlines:
    return Outlines(
        np.zeros(0, dtype=np.float32), np.zeros(1, dtype=np.int64), np.zeros((0, 2), np.float64)
    )


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
        return no_outlines()
    shapes = outline_shapes(geometries)
    coords, owners = shapely.get_coordinates(shapes, return_index=True)
    counts = np.bincount(owners, minlength=len(shapes))
    ends = np.cumsum(counts)
    starts = ends - counts
    closed = (counts > 1) & np.all(coords[ends - 1] == coords[starts], axis=1)
    keep = np.ones(len(coords), dtype=bool)
    keep[(ends - 1)[closed]] = False
    points = coords[keep].astype(np.float32).reshape(-1)
    offsets = np.concatenate(([0], np.cumsum(counts - closed))).astype(np.int64)
    return Outlines(points, offsets, centres_of(points, offsets))


class Column[T: np.generic]:
    def __init__(self, dtype: type[T], path: Path) -> None:
        self.dtype = dtype
        self.path = path
        self.length = 0

    def add(self, values: NDArray[Any]) -> None:
        with self.path.open("ab") as handle:
            np.ascontiguousarray(values, dtype=self.dtype).tofile(handle)
        self.length += len(values)

    def read(self) -> NDArray[T]:
        if not self.length:
            return np.zeros(0, dtype=self.dtype)
        found = np.fromfile(self.path, dtype=self.dtype, count=self.length)
        self.path.unlink()
        return found


def offsets_of(lengths: NDArray[np.int64]) -> NDArray[np.int64]:
    found = np.zeros(len(lengths) + 1, dtype=np.int64)
    np.cumsum(lengths, out=found[1:])
    return found


@dataclass
class Names:
    ids: dict[str, int] = field(default_factory=dict[str, int])
    names: list[str] = field(default_factory=list[str])
    overflow: bool = False

    def id_of(self, name: str | None) -> int:
        key = class_key(name)
        if key is None:
            return NO_CLASS
        found = self.ids.get(key)
        if found is not None:
            return found
        if len(self.names) >= MAX_NAMES:
            self.overflow = True
            return NO_CLASS
        self.ids[key] = len(self.names)
        self.names.append((name or "").strip()[:NAME_LENGTH])
        return self.ids[key]


@dataclass(frozen=True)
class IncomingCells:
    outlines: Outlines
    nucleus: Outlines | None
    class_ids: NDArray[np.int32]
    scores: NDArray[np.uint8]
    probability_cells: int
    probability_owner: NDArray[np.int32]
    probability_name: NDArray[np.int32]
    probability_scaled: NDArray[np.uint8]
    class_names: Names
    probability_names: Names

    def __len__(self) -> int:
        return len(self.outlines)


class CellCollector:
    def __init__(self, folder: Path | None = None) -> None:
        self.folder = Path(tempfile.mkdtemp(prefix="cells-", dir=folder))
        self.class_names = Names()
        self.probability_names = Names()
        self.count = 0
        self.probability_cells = 0
        self.with_nucleus = False
        self.points = self.column("points", np.float32)
        self.lengths = self.column("lengths", np.int64)
        self.nucleus_points = self.column("nucleus_points", np.float32)
        self.nucleus_lengths = self.column("nucleus_lengths", np.int64)
        self.class_ids = self.column("class_ids", np.int32)
        self.scores = self.column("scores", np.uint8)
        self.owners = self.column("owners", np.int32)
        self.names = self.column("names", np.int32)
        self.scaled = self.column("scaled", np.uint8)

    def column[T: np.generic](self, name: str, dtype: type[T]) -> Column[T]:
        return Column(dtype, self.folder / name)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *details: object) -> None:
        shutil.rmtree(self.folder, ignore_errors=True)

    def add(self, cells: Sequence[ResultObject]) -> None:
        if not cells:
            return
        traced = outlines([cell.geometry for cell in cells])
        self.points.add(traced.points)
        self.lengths.add(np.diff(traced.offsets))
        self.add_nuclei(cells)
        self.class_ids.add(
            np.fromiter(
                (self.class_names.id_of(cell.class_name) for cell in cells),
                dtype=np.int32,
                count=len(cells),
            )
        )
        self.scores.add(
            np.fromiter(
                (scaled(cell.score) or 0 for cell in cells), dtype=np.uint8, count=len(cells)
            )
        )
        self.add_probabilities(cells)
        self.count += len(cells)

    def add_nuclei(self, cells: Sequence[ResultObject]) -> None:
        present = [index for index, cell in enumerate(cells) if cell.nucleus is not None]
        lengths = np.zeros(len(cells), dtype=np.int64)
        if present:
            self.with_nucleus = True
            traced = outlines([cell.nucleus for cell in cells if cell.nucleus is not None])
            lengths[present] = np.diff(traced.offsets)
            self.nucleus_points.add(traced.points)
        self.nucleus_lengths.add(lengths)

    def add_probabilities(self, cells: Sequence[ResultObject]) -> None:
        owners: list[int] = []
        names: list[int] = []
        values: list[float] = []
        for index, cell in enumerate(cells, start=self.count):
            if not cell.probabilities:
                continue
            self.probability_cells += 1
            for name, value in cell.probabilities.items():
                found = self.probability_names.id_of(name)
                if found != NO_CLASS:
                    owners.append(index)
                    names.append(found)
                    values.append(value)
        if owners:
            self.owners.add(np.array(owners, dtype=np.int32))
            self.names.add(np.array(names, dtype=np.int32))
            self.scaled.add(scaled_all(np.array(values, dtype=np.float64)))

    def finish(self) -> IncomingCells:
        points = self.points.read()
        offsets = offsets_of(self.lengths.read())
        nucleus = None
        if self.with_nucleus:
            nucleus = Outlines(
                self.nucleus_points.read(),
                offsets_of(self.nucleus_lengths.read()),
                np.zeros((0, 2), np.float64),
            )
        return IncomingCells(
            outlines=Outlines(points, offsets, centres_of(points, offsets)),
            nucleus=nucleus,
            class_ids=self.class_ids.read(),
            scores=self.scores.read(),
            probability_cells=self.probability_cells,
            probability_owner=self.owners.read(),
            probability_name=self.names.read(),
            probability_scaled=self.scaled.read(),
            class_names=self.class_names,
            probability_names=self.probability_names,
        )


def innermost_regions(
    centres: NDArray[np.float64], regions: Sequence[tuple[int, BaseGeometry]]
) -> NDArray[np.uint32]:
    found = np.zeros(len(centres), dtype=np.uint32)
    if not regions or not len(centres):
        return found
    tree = STRtree([geometry for _, geometry in regions])
    areas = np.array([geometry.area for _, geometry in regions], dtype=np.float64)
    numbers = np.array([number for number, _ in regions], dtype=np.uint32)
    for first in range(0, len(centres), REGION_QUERY_CELLS):
        part = centres[first : first + REGION_QUERY_CELLS]
        point_indexes, region_indexes = tree.query(shapely.points(part), predicate="intersects")
        if not len(point_indexes):
            continue
        order = np.lexsort((numbers[region_indexes], areas[region_indexes], point_indexes))
        _, firsts = np.unique(point_indexes[order], return_index=True)
        chosen = order[firsts]
        found[first + point_indexes[chosen]] = numbers[region_indexes[chosen]]
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
