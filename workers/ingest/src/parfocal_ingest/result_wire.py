import io
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import msgspec
import numpy as np
from numpy.typing import NDArray
from shapely.geometry import mapping
from shapely.geometry import shape as shape_of

from parfocal_common.ingest import Refusal
from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import ImportFailure, ResultFormat
from parfocal_ingest.cell_import import NO_CLASS, IncomingCells, Names, Outlines
from parfocal_ingest.chunk_builder import centres_of
from parfocal_ingest.import_checks import Choices, SlideFrame, Tally, heatmap_values
from parfocal_ingest.isolated_child import ScopedStorage
from parfocal_ingest.isolation import read_output, required_output
from parfocal_ingest.results import ObjectKind, ResultObject

FACTS_OUTPUT = "facts.msgpack"
HEATMAP_OUTPUT = "heatmap.npy"
SHAPE_TYPES = frozenset(
    {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}
)
ARRAYS: Mapping[str, type[np.generic]] = {
    "points": np.float32,
    "offsets": np.int64,
    "nucleus_points": np.float32,
    "nucleus_offsets": np.int64,
    "class_ids": np.int32,
    "scores": np.uint8,
    "probability_owner": np.int32,
    "probability_name": np.int32,
    "probability_scaled": np.uint8,
}


class WireGeometry(msgspec.Struct):
    type: str
    coordinates: Any


class WireShape(msgspec.Struct):
    kind: ObjectKind
    geometry: WireGeometry
    class_name: str | None = None
    score: float | None = None
    probabilities: dict[str, float] | None = None
    source_id: str | None = None
    parent: str | None = None
    properties: dict[str, Any] = msgspec.field(default_factory=dict[str, Any])


class WireModel(msgspec.Struct):
    name: str | None = None
    version: str | None = None
    run_at: str | None = None


class WireParse(msgspec.Struct):
    format: ResultFormat
    shapes: list[WireShape]
    skipped: int
    unreadable: bool
    model: WireModel
    declared_classes: list[str]
    tally: Tally
    probability_cells: int
    class_names: Names
    probability_names: Names
    nucleus: bool


def wire_shape(item: ResultObject) -> WireShape:
    found = mapping(item.geometry)
    return WireShape(
        item.kind,
        WireGeometry(str(found["type"]), found["coordinates"]),
        item.class_name,
        item.score,
        item.probabilities,
        item.source_id,
        item.parent,
        item.properties,
    )


def shape_from(item: WireShape) -> ResultObject:
    if item.geometry.type not in SHAPE_TYPES:
        raise ValueError(item.geometry.type)
    geometry = shape_of({"type": item.geometry.type, "coordinates": item.geometry.coordinates})
    return ResultObject(
        item.kind,
        geometry,
        item.class_name,
        item.score,
        item.probabilities,
        item.source_id,
        item.parent,
        None,
        item.properties,
    )


def save_array(folder: Path, name: str, values: NDArray[Any]) -> None:
    with (folder / f"{name}.npy").open("wb") as handle:
        np.save(handle, np.ascontiguousarray(values, dtype=ARRAYS[name]), allow_pickle=False)


def array_from(data: bytes, dtype: type[np.generic]) -> NDArray[Any]:
    found = np.load(io.BytesIO(data), allow_pickle=False)
    if not isinstance(found, np.ndarray) or found.dtype != np.dtype(dtype):
        raise ValueError("array")
    return found


def arrays_of(cells: IncomingCells) -> dict[str, NDArray[Any]]:
    nucleus = cells.nucleus
    return {
        "points": cells.outlines.points,
        "offsets": cells.outlines.offsets,
        "nucleus_points": np.zeros(0, np.float32) if nucleus is None else nucleus.points,
        "nucleus_offsets": np.zeros(1, np.int64) if nucleus is None else nucleus.offsets,
        "class_ids": cells.class_ids,
        "scores": cells.scores,
        "probability_owner": cells.probability_owner,
        "probability_name": cells.probability_name,
        "probability_scaled": cells.probability_scaled,
    }


def write_parse(folder: Path, parsed: Any, tally: Tally) -> None:
    cells: IncomingCells = parsed.cells
    for name, values in arrays_of(cells).items():
        save_array(folder, name, values)
    facts = WireParse(
        parsed.format,
        [wire_shape(item) for item in parsed.shapes],
        parsed.skipped,
        parsed.unreadable,
        WireModel(parsed.model.name, parsed.model.version, parsed.model.run_at),
        list(parsed.declared_classes),
        tally,
        cells.probability_cells,
        cells.class_names,
        cells.probability_names,
        cells.nucleus is not None,
    )
    (folder / FACTS_OUTPUT).write_bytes(msgspec.msgpack.encode(facts))


def consistent_offsets(offsets: NDArray[np.int64], points: NDArray[np.float32]) -> bool:
    return (
        offsets.ndim == 1
        and len(offsets) >= 1
        and int(offsets[0]) == 0
        and bool(np.all(np.diff(offsets) >= 0))
        and int(offsets[-1]) <= len(points)
    )


def in_range(values: NDArray[Any], size: int, empty: int | None = None) -> bool:
    allowed = (values >= 0) & (values < size)
    if empty is not None:
        allowed |= values == empty
    return bool(np.all(allowed))


def cells_from(facts: WireParse, arrays: Mapping[str, NDArray[Any]]) -> IncomingCells:
    points, offsets = arrays["points"], arrays["offsets"]
    count = len(offsets) - 1
    owners = arrays["probability_owner"]
    names = arrays["probability_name"]
    if not (
        consistent_offsets(offsets, points)
        and consistent_offsets(arrays["nucleus_offsets"], arrays["nucleus_points"])
        and len(arrays["class_ids"]) == count
        and len(arrays["scores"]) == count
        and len(owners) == len(names) == len(arrays["probability_scaled"])
        and in_range(owners, count)
        and in_range(names, len(facts.probability_names.names))
        and in_range(arrays["class_ids"], len(facts.class_names.names), NO_CLASS)
    ):
        raise ValueError("cells")
    nucleus = None
    if facts.nucleus:
        nucleus = Outlines(
            arrays["nucleus_points"], arrays["nucleus_offsets"], np.zeros((0, 2), np.float64)
        )
    return IncomingCells(
        outlines=Outlines(points, offsets, centres_of(points, offsets)),
        nucleus=nucleus,
        class_ids=arrays["class_ids"],
        scores=arrays["scores"],
        probability_cells=facts.probability_cells,
        probability_owner=owners,
        probability_name=names,
        probability_scaled=arrays["probability_scaled"],
        class_names=facts.class_names,
        probability_names=facts.probability_names,
    )


def read_parse(folder: Path) -> tuple[WireParse, list[ResultObject], IncomingCells]:
    try:
        facts = msgspec.msgpack.decode(required_output(folder, FACTS_OUTPUT), type=WireParse)
        arrays = {
            name: array_from(required_output(folder, f"{name}.npy"), dtype)
            for name, dtype in ARRAYS.items()
        }
        shapes = [shape_from(item) for item in facts.shapes]
        cells = cells_from(facts, arrays)
    except msgspec.DecodeError, msgspec.ValidationError, ValueError, TypeError, IndexError:
        raise StepFailedError(ImportFailure.UNREADABLE) from None
    return facts, shapes, cells


def heatmap_from(folder: Path) -> NDArray[Any]:
    data = read_output(folder, HEATMAP_OUTPUT)
    try:
        if data is None:
            raise ValueError("heatmap")
        found = np.load(io.BytesIO(data), allow_pickle=False)
        if not isinstance(found, np.ndarray) or found.dtype.kind not in "biuf":
            raise ValueError("heatmap")
    except ValueError:
        raise StepFailedError(ImportFailure.UNREADABLE) from None
    return found


def frame_of(arguments: Mapping[str, Any]) -> SlideFrame:
    return msgspec.convert(arguments["frame"], SlideFrame)


def choices_of(arguments: Mapping[str, Any]) -> Choices | None:
    found = arguments.get("choices")
    return None if found is None else msgspec.convert(found, Choices)


def parse_results(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    from parfocal_ingest.result_import import read_checked

    path = storage.fetch(arguments["key"])
    parsed, tally = read_checked(
        path, arguments.get("format"), frame_of(arguments), choices_of(arguments)
    )
    write_parse(Path(arguments["out"]), parsed, tally)
    return {}


def parse_heatmap(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    values = heatmap_values(storage.fetch(arguments["key"]), arguments["file_name"])
    with (Path(arguments["out"]) / HEATMAP_OUTPUT).open("wb") as handle:
        np.save(handle, values, allow_pickle=False)
    return {}


def wire_unreadable(code: str) -> str:
    return ImportFailure.UNREADABLE if code == Refusal.UNREADABLE else code
