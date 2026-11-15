import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, cast

import numpy as np
import shapely
import tifffile
from numpy.typing import NDArray
from PIL import Image

from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import CheckProblem, ImportFailure, ResultFormat, ScoreDefault
from parfocal_ingest.cell_import import class_key
from parfocal_ingest.results import ObjectKind, ReadResult, ResultObject, load_raster

PLACES = 200
HEATMAP_DIMENSIONS = 2
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
    tissue_share: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "downsample": self.downsample,
            "mpp": self.mpp,
            "tissue_share": self.tissue_share,
        }


@dataclass(frozen=True)
class TissueCells:
    cell: int
    cells: NDArray[np.bool_]


RASTER_ERRORS = (
    OSError,
    ValueError,
    SyntaxError,
    IndexError,
    tifffile.TiffFileError,
    Image.DecompressionBombError,
)


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


def heatmap_values(path: Path, file_name: str) -> NDArray[Any]:
    try:
        values = np.squeeze(load_raster(path.read_bytes(), file_name))
    except RASTER_ERRORS:
        raise StepFailedError(ImportFailure.HEATMAP_UNREADABLE) from None
    if values.ndim != HEATMAP_DIMENSIONS or not values.size or values.dtype.kind not in "biuf":
        raise StepFailedError(ImportFailure.HEATMAP_UNREADABLE)
    return values


def tissue_share(
    values: NDArray[Any], downsample: float, tissue: TissueCells | None
) -> float | None:
    if tissue is None:
        return None
    weights = np.clip(np.nan_to_num(values.astype(np.float32), nan=0.0), 0, None)
    total = float(weights.sum(dtype=np.float64))
    if total <= 0:
        return None
    height, width = weights.shape
    rows = ((np.arange(height) + 0.5) * downsample // tissue.cell).astype(np.int64)
    cols = ((np.arange(width) + 0.5) * downsample // tissue.cell).astype(np.int64)
    row_in = rows < tissue.cells.shape[0]
    col_in = cols < tissue.cells.shape[1]
    on = tissue.cells[np.ix_(rows[row_in], cols[col_in])]
    landed = float(weights[np.ix_(row_in, col_in)][on].sum(dtype=np.float64))
    return round(landed / total, 4)


def heatmap_guesses(
    values: NDArray[Any], frame: SlideFrame, tissue: TissueCells | None
) -> list[Guess]:
    fitted = heatmap_guess(values.shape, frame)
    guesses = [fitted] if fitted is not None else []
    for level in range(frame.level_count or 0):
        if fitted is None or level != fitted.level:
            scale = float(2**level)
            guesses.append(Guess(level, scale, frame.mpp * scale if frame.mpp else None))
    shared = [
        replace(guess, tissue_share=tissue_share(values, guess.downsample, tissue))
        for guess in guesses
    ]
    if fitted is None:
        shared.sort(key=lambda guess: -1.0 if guess.tissue_share is None else -guess.tissue_share)
    return shared


def heatmap_problems(
    values: NDArray[Any], frame: SlideFrame, tissue: TissueCells | None = None
) -> list[dict[str, Any]]:
    guesses = heatmap_guesses(values, frame, tissue)
    return [
        {
            "code": CheckProblem.HEATMAP_SCALE.value,
            "count": 1,
            "places": [],
            "guess": guesses[0].as_dict() if guesses else None,
            "guesses": [guess.as_dict() for guess in guesses],
        }
    ]


def accepted_guess(stored: Any, level: int | None = None) -> Guess:
    found = cast("dict[str, Any]", stored or {}).get("problems") or []
    for item in cast("list[dict[str, Any]]", found):
        if item.get("code") != CheckProblem.HEATMAP_SCALE.value:
            continue
        offered = cast("list[dict[str, Any]]", item.get("guesses") or [])
        picked = (
            item.get("guess")
            if level is None
            else next((guess for guess in offered if guess.get("level") == level), None)
        )
        if picked:
            return Guess(
                picked.get("level"),
                float(picked["downsample"]),
                picked.get("mpp"),
                picked.get("tissue_share"),
            )
    raise StepFailedError(ImportFailure.HEATMAP_UNPLACED)


def stored_values(values: NDArray[Any]) -> NDArray[np.uint8]:
    if values.dtype == np.uint8:
        return values
    if values.dtype.kind == "b":
        return values.astype(np.uint8) * 255
    if values.dtype.kind in "iu":
        top = float(np.iinfo(values.dtype).max)
        scaled = np.clip(values.astype(np.float64), 0, None) / top
    else:
        scaled = np.clip(np.nan_to_num(values.astype(np.float64), nan=0.0), 0, 1)
    return np.rint(scaled * 255).astype(np.uint8)
