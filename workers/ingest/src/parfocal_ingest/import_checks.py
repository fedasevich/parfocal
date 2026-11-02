import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import numpy as np
import shapely
import tifffile
from numpy.typing import NDArray
from PIL import Image

from parfocal_common.result_imports import CheckProblem, ResultFormat, ScoreDefault
from parfocal_ingest.cell_import import class_key
from parfocal_ingest.results import ObjectKind, ReadResult, ResultObject

PLACES = 200
RATIO_TOLERANCE = 0.02
LEVEL_TOLERANCE = 0.05
CLASSED_KINDS = frozenset({ObjectKind.REGION, ObjectKind.CELL})
PLACE_NAMES: Mapping[ResultFormat, tuple[str, int]] = {
    ResultFormat.GEOJSON: ("feature", 1),
    ResultFormat.PARFOCAL_JSON: ("object", 1),
    ResultFormat.CSV: ("row", 2),
}


@dataclass(frozen=True)
class SlideFrame:
    width: int | None = None
    height: int | None = None
    level_count: int | None = None
    mpp: float | None = None

    @property
    def known(self) -> bool:
        return bool(self.width and self.height)


@dataclass(frozen=True)
class Choices:
    score_default: ScoreDefault | None = None
    unclassified: str | None = None
    renames: Mapping[str, str] = field(default_factory=dict[str, str])

    def adjusted(self, item: ResultObject) -> ResultObject:
        changes: dict[str, Any] = {}
        name = self.renamed(item.class_name)
        if name is None and item.kind in CLASSED_KINDS:
            name = self.unclassified
        if name != item.class_name:
            changes["class_name"] = name
        if item.score is None and self.score_default is ScoreDefault.ONE:
            changes["score"] = 1.0
        if item.probabilities:
            renamed = {self.renamed(key) or key: value for key, value in item.probabilities.items()}
            if renamed != item.probabilities:
                changes["probabilities"] = renamed
        return replace(item, **changes) if changes else item

    def renamed(self, name: str | None) -> str | None:
        key = class_key(name)
        if key is None:
            return None
        return self.renames.get(key, name)


@dataclass
class Places:
    count: int = 0
    names: list[str] = field(default_factory=list[str])

    def add(self, place: str) -> None:
        self.count += 1
        if len(self.names) < PLACES:
            self.names.append(place)


@dataclass
class Tally:
    chosen: ResultFormat
    frame: SlideFrame = field(default_factory=SlideFrame)
    readable: int = 0
    classed: int = 0
    scored: int = 0
    inside: int = 0
    unreadable: Places = field(default_factory=Places)
    unclassed: Places = field(default_factory=Places)
    unscored: Places = field(default_factory=Places)
    outside: Places = field(default_factory=Places)
    class_names: dict[str, str] = field(default_factory=dict[str, str])
    next_index: int = 0

    def __post_init__(self) -> None:
        self.next_index = PLACE_NAMES.get(self.chosen, ("object", 1))[1]

    @property
    def prefix(self) -> str:
        return PLACE_NAMES.get(self.chosen, ("object", 1))[0]

    def take(self, batch: ReadResult) -> None:
        failed = {index_of(problem.where) for problem in batch.problems if problem.where != "file"}
        for problem in batch.problems:
            if problem.where != "file":
                self.unreadable.add(problem.where)
        outside = self.outside_of(batch.objects)
        for item, out in zip(batch.objects, outside, strict=True):
            while self.next_index in failed:
                self.next_index += 1
            self.count(item, f"{self.prefix} {self.next_index}", out=bool(out))
            self.next_index += 1
        self.next_index += sum(
            1 for index in failed if index is not None and index >= self.next_index
        )

    def count(self, item: ResultObject, place: str, *, out: bool) -> None:
        self.readable += 1
        if out:
            self.outside.add(place)
        else:
            self.inside += 1
        key = class_key(item.class_name)
        if key is not None:
            self.class_names.setdefault(key, (item.class_name or "").strip())
        for name in item.probabilities or {}:
            found = class_key(name)
            if found is not None:
                self.class_names.setdefault(found, name.strip())
        if item.kind in CLASSED_KINDS:
            if key is None:
                self.unclassed.add(place)
            else:
                self.classed += 1
        if item.kind is not ObjectKind.ZONE:
            if item.score is None:
                self.unscored.add(place)
            else:
                self.scored += 1

    def outside_of(self, items: Sequence[ResultObject]) -> NDArray[np.bool_]:
        if not items or not self.frame.known:
            return np.zeros(len(items), dtype=np.bool_)
        bounds = shapely.bounds(np.array([item.geometry for item in items], dtype=object))
        width, height = float(self.frame.width or 0), float(self.frame.height or 0)
        return (
            (bounds[:, 0] > width)
            | (bounds[:, 1] > height)
            | (bounds[:, 2] < 0)
            | (bounds[:, 3] < 0)
        )

    @property
    def all_outside(self) -> bool:
        return self.readable > 0 and self.inside == 0 and self.outside.count == self.readable


def index_of(where: str) -> int | None:
    _, _, number = where.rpartition(" ")
    return int(number) if number.isdigit() else None


@dataclass(frozen=True)
class KnownClasses:
    class_keys: frozenset[str] = frozenset()
    renames: Mapping[str, str] = field(default_factory=dict[str, str])


def problem(code: CheckProblem, places: Places, **extra: Any) -> dict[str, Any]:
    return {"code": code.value, "count": places.count, "places": places.names, **extra}


def problems_of(
    tally: Tally, known: KnownClasses, declared: Sequence[str] = ()
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if tally.unreadable.count:
        found.append(problem(CheckProblem.UNREADABLE_OBJECTS, tally.unreadable))
    if tally.unclassed.count and tally.classed:
        found.append(problem(CheckProblem.OBJECTS_WITHOUT_CLASS, tally.unclassed))
    unknown = unknown_classes(tally, known, declared)
    if unknown:
        found.append(
            {"code": CheckProblem.UNKNOWN_CLASSES.value, "count": len(unknown), "names": unknown}
        )
    if tally.unscored.count and tally.scored:
        found.append(problem(CheckProblem.SCORES_MISSING, tally.unscored))
    if tally.outside.count:
        found.append(problem(CheckProblem.PARTLY_OUTSIDE, tally.outside))
    return found


def unknown_classes(tally: Tally, known: KnownClasses, declared: Sequence[str]) -> list[str]:
    if not known.class_keys:
        return []
    names = dict(tally.class_names)
    for name in declared:
        key = class_key(name)
        if key is not None:
            names.setdefault(key, name.strip())
    return [
        name
        for key, name in names.items()
        if key not in known.class_keys and key not in known.renames
    ]


@dataclass(frozen=True)
class Guess:
    level: int | None
    downsample: float
    mpp: float | None

    def as_dict(self) -> dict[str, Any]:
        return {"level": self.level, "downsample": self.downsample, "mpp": self.mpp}


def heatmap_guess(shape: Sequence[int], frame: SlideFrame) -> Guess | None:
    if len(shape) < 2 or not frame.known or not shape[0] or not shape[1]:
        return None
    across = (frame.width or 0) / shape[1]
    down = (frame.height or 0) / shape[0]
    if abs(across - down) / max(across, down) > RATIO_TOLERANCE:
        return None
    downsample = (across + down) / 2
    level = round(math.log2(downsample)) if downsample >= 1 else None
    if level is not None and (
        abs(2**level - downsample) / downsample > LEVEL_TOLERANCE
        or (frame.level_count is not None and level >= frame.level_count)
    ):
        level = None
    scale = float(2**level) if level is not None else round(downsample, 3)
    return Guess(level, scale, frame.mpp * scale if frame.mpp else None)


def raster_shape(path: Path) -> tuple[int, ...]:
    try:
        with tifffile.TiffFile(path) as tiff:
            return tuple(tiff.series[0].shape)
    except tifffile.TiffFileError:
        with Image.open(path) as image:
            return (image.height, image.width)


def heatmap_problems(shape: Sequence[int], frame: SlideFrame) -> list[dict[str, Any]]:
    guess = heatmap_guess(shape, frame)
    return [
        {
            "code": CheckProblem.HEATMAP_SCALE.value,
            "count": 1,
            "places": [],
            "guess": guess.as_dict() if guess is not None else None,
        }
    ]
