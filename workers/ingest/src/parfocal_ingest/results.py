import csv
import io
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import cv2
import msgspec
import numpy as np
import shapely
import tifffile
from numpy.typing import NDArray
from PIL import Image
from scipy import ndimage
from shapely.geometry import Point, Polygon, shape
from shapely.geometry.base import BaseGeometry

SNIFF_BYTES = 4096
GEOMETRY_TYPES = frozenset({"Point", "Polygon", "MultiPolygon"})
CELL_TYPES = frozenset({"cell", "detection"})
REGION_TYPES = frozenset({"annotation", "region"})
COLUMN_GUESSES = {
    "x": ("x", "centroid_x", "centroid x", "centroid x µm", "cx", "x_px", "pos_x"),
    "y": ("y", "centroid_y", "centroid y", "centroid y µm", "cy", "y_px", "pos_y"),
    "class_name": ("class", "label", "type", "classification", "cell_type", "class_name"),
    "score": ("score", "confidence", "probability", "prob"),
    "polygon": ("polygon", "wkt", "geometry", "outline"),
    "source_id": ("id", "object_id", "cell_id", "name"),
}


class ObjectKind(StrEnum):
    REGION = "region"
    CELL = "cell"
    ZONE = "zone"


@dataclass(frozen=True)
class ResultObject:
    kind: ObjectKind
    geometry: BaseGeometry
    class_name: str | None = None
    score: float | None = None
    probabilities: dict[str, float] | None = None
    source_id: str | None = None
    parent: str | None = None
    nucleus: BaseGeometry | None = None
    properties: dict[str, Any] = field(default_factory=dict[str, Any])


@dataclass(frozen=True)
class Heatmap:
    values: NDArray[Any]
    level: int
    downsample: float
    class_name: str | None = None


@dataclass(frozen=True)
class Problem:
    where: str
    message: str


@dataclass
class ReadResult:
    objects: list[ResultObject] = field(default_factory=list[ResultObject])
    heatmaps: list[Heatmap] = field(default_factory=list[Heatmap])
    problems: list[Problem] = field(default_factory=list[Problem])


class Classification(msgspec.Struct):
    name: str | None = None
    color: list[int] | int | None = None


class Feature(msgspec.Struct):
    type: str
    geometry: dict[str, Any] | None = None
    properties: dict[str, Any] | None = None
    id: str | int | None = None
    nucleus_geometry: dict[str, Any] | None = msgspec.field(name="nucleusGeometry", default=None)


class FeatureCollection(msgspec.Struct):
    type: str
    features: list[Feature]


def features_of(data: bytes) -> list[Feature]:
    raw = msgspec.json.decode(data)
    if isinstance(raw, list):
        return msgspec.convert(raw, list[Feature])
    if isinstance(raw, dict) and raw.get("type") == "FeatureCollection":
        return msgspec.convert(raw, FeatureCollection).features
    if isinstance(raw, dict) and raw.get("type") == "Feature":
        return [msgspec.convert(raw, Feature)]
    raise ValueError("This is not GeoJSON: expected a FeatureCollection, a feature or a list")


def geometry_of(value: dict[str, Any]) -> BaseGeometry:
    if value.get("type") not in GEOMETRY_TYPES:
        raise ValueError(f"{value.get('type')} geometry is not supported")
    found = shape(value)
    if not found.is_valid:
        found = shapely.make_valid(found)
    if found.is_empty:
        raise ValueError("The geometry is empty")
    return found


def measurements_of(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        return {
            item["name"]: item.get("value")
            for item in value
            if isinstance(item, dict) and "name" in item
        }
    return {}


def classification_of(properties: dict[str, Any]) -> str | None:
    found = properties.get("classification")
    if isinstance(found, dict):
        return msgspec.convert(found, Classification).name
    if isinstance(found, str):
        return found
    name = properties.get("class") or properties.get("class_name")
    return str(name) if name is not None else None


def kind_of(properties: dict[str, Any], geometry: BaseGeometry) -> ObjectKind:
    stated = str(properties.get("objectType") or properties.get("kind") or "").lower()
    if stated == "tile":
        raise ValueError("Tiles are not results")
    if stated in CELL_TYPES:
        return ObjectKind.CELL
    if stated == ObjectKind.ZONE:
        return ObjectKind.ZONE
    if stated in REGION_TYPES:
        return ObjectKind.REGION
    return ObjectKind.CELL if isinstance(geometry, Point) else ObjectKind.REGION


def number_or_none(value: Any) -> float | None:
    try:
        return None if value is None or value == "" else float(value)
    except TypeError, ValueError:
        return None


def read_geojson(data: bytes) -> ReadResult:
    result = ReadResult()
    try:
        features = features_of(data)
    except (msgspec.DecodeError, msgspec.ValidationError, ValueError) as error:
        result.problems.append(Problem("file", str(error)))
        return result
    for index, feature in enumerate(features, start=1):
        where = f"feature {index}"
        properties = dict(feature.properties or {})
        try:
            if feature.geometry is None:
                raise ValueError("The feature has no geometry")
            geometry = geometry_of(feature.geometry)
            nucleus_value = feature.nucleus_geometry or properties.pop("nucleusGeometry", None)
            nucleus = geometry_of(nucleus_value) if nucleus_value else None
            kind = kind_of(properties, geometry)
        except (ValueError, TypeError, msgspec.ValidationError) as error:
            result.problems.append(Problem(where, str(error)))
            continue
        probabilities = properties.get("probabilities")
        result.objects.append(
            ResultObject(
                kind=kind,
                geometry=geometry,
                class_name=classification_of(properties),
                score=number_or_none(properties.get("score")),
                probabilities=(
                    {str(k): float(v) for k, v in probabilities.items()}
                    if isinstance(probabilities, dict)
                    else None
                ),
                source_id=None if feature.id is None else str(feature.id),
                parent=properties.get("parent"),
                nucleus=nucleus,
                properties=measurements_of(properties.get("measurements")),
            )
        )
    return result


@dataclass(frozen=True)
class ColumnMapping:
    x: str | None = None
    y: str | None = None
    class_name: str | None = None
    score: str | None = None
    polygon: str | None = None
    source_id: str | None = None


def dialect_of(text: str) -> type[csv.Dialect] | csv.Dialect:
    try:
        return csv.Sniffer().sniff(text[:SNIFF_BYTES], delimiters=",\t;")
    except csv.Error:
        return csv.excel_tab if "\t" in text.splitlines()[0] else csv.excel


def guess_mapping(header: Sequence[str]) -> ColumnMapping:
    lowered = {column.strip().lower(): column for column in header}
    found = {
        target: next((lowered[name] for name in names if name in lowered), None)
        for target, names in COLUMN_GUESSES.items()
    }
    return ColumnMapping(**found)


def header_of(data: bytes) -> list[str]:
    text = data.decode("utf-8-sig")
    return next(csv.reader(io.StringIO(text), dialect_of(text)), [])


def read_table(data: bytes, mapping: ColumnMapping) -> ReadResult:
    result = ReadResult()
    text = data.decode("utf-8-sig")
    rows = csv.DictReader(io.StringIO(text), dialect=dialect_of(text))
    if mapping.polygon is None and (mapping.x is None or mapping.y is None):
        result.problems.append(Problem("file", "Map the x and y columns or a polygon column"))
        return result
    for line, row in enumerate(rows, start=2):
        where = f"row {line}"
        try:
            if mapping.polygon is not None and row.get(mapping.polygon):
                geometry = shapely.from_wkt(row[mapping.polygon])
                if not geometry.is_valid:
                    geometry = shapely.make_valid(geometry)
            else:
                x, y = (
                    number_or_none(row.get(mapping.x or "")),
                    number_or_none(row.get(mapping.y or "")),
                )
                if x is None or y is None:
                    raise ValueError("x and y must be numbers")
                geometry = Point(x, y)
        except (ValueError, shapely.errors.GEOSException) as error:
            result.problems.append(Problem(where, str(error)))
            continue
        used = {
            mapping.x,
            mapping.y,
            mapping.class_name,
            mapping.score,
            mapping.polygon,
            mapping.source_id,
        }
        result.objects.append(
            ResultObject(
                kind=ObjectKind.CELL,
                geometry=geometry,
                class_name=(row.get(mapping.class_name) or None) if mapping.class_name else None,
                score=number_or_none(row.get(mapping.score)) if mapping.score else None,
                source_id=(row.get(mapping.source_id) or None) if mapping.source_id else None,
                properties={k: v for k, v in row.items() if k not in used and k is not None},
            )
        )
    return result


def traced(mask: NDArray[np.bool_], top: int, left: int, downsample: float) -> BaseGeometry | None:
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    polygons = [
        Polygon(
            [((left + x + 0.5) * downsample, (top + y + 0.5) * downsample) for [[x, y]] in contour]
        )
        for contour in contours
        if len(contour) >= 3
    ]
    shapes = [polygon if polygon.is_valid else shapely.make_valid(polygon) for polygon in polygons]
    shapes = [item for item in shapes if not item.is_empty and item.area > 0]
    if not shapes:
        return None
    return shapes[0] if len(shapes) == 1 else shapely.union_all(shapes)


def labelled_objects(labels: NDArray[Any], downsample: float) -> Iterable[tuple[int, BaseGeometry]]:
    for index, box in enumerate(ndimage.find_objects(labels), start=1):
        if box is None:
            continue
        window = labels[box] == index
        geometry = traced(window, box[0].start, box[1].start, downsample)
        if geometry is not None:
            yield index, geometry


def read_instance_mask(
    labels: NDArray[Any], downsample: float, kind: ObjectKind = ObjectKind.CELL
) -> ReadResult:
    result = ReadResult()
    for label, geometry in labelled_objects(labels, downsample):
        result.objects.append(ResultObject(kind=kind, geometry=geometry, source_id=str(label)))
    return result


def read_class_mask(
    classes: NDArray[Any],
    names: dict[int, str],
    downsample: float,
    kind: ObjectKind = ObjectKind.REGION,
) -> ReadResult:
    result = ReadResult()
    for value in sorted(int(v) for v in np.unique(classes) if v != 0):
        components = np.zeros(classes.shape, dtype=np.int32)
        ndimage.label(classes == value, output=components)
        for _, geometry in labelled_objects(components, downsample):
            result.objects.append(
                ResultObject(kind=kind, geometry=geometry, class_name=names.get(value, str(value)))
            )
        if value not in names:
            result.problems.append(Problem(f"value {value}", "The mask value has no class name"))
    return result


def load_raster(data: bytes, file_name: str) -> NDArray[Any]:
    if file_name.lower().endswith((".tif", ".tiff")):
        return tifffile.imread(io.BytesIO(data))
    with Image.open(io.BytesIO(data)) as image:
        return np.asarray(image)


def read_heatmap(
    values: NDArray[Any], level: int, downsample: float, class_name: str | None = None
) -> ReadResult:
    if values.ndim != 2:
        return ReadResult(problems=[Problem("file", "A heatmap is a single-channel image")])
    return ReadResult(heatmaps=[Heatmap(values, level, downsample, class_name)])
