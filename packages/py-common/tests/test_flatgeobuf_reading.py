from typing import Any

from parfocal_common import flatgeobuf
from parfocal_common.flatgeobuf import ColumnType

COLUMNS = [("id", ColumnType.STRING), ("score", ColumnType.INT), ("area", ColumnType.DOUBLE)]
SQUARE = [[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 0.0]]
HOLE = [[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 1.0]]
SHAPES: list[dict[str, Any]] = [
    {"type": "Point", "coordinates": [3.5, 7.25]},
    {"type": "LineString", "coordinates": [[0.0, 0.0], [10.0, 5.0]]},
    {"type": "Polygon", "coordinates": [SQUARE]},
    {"type": "Polygon", "coordinates": [SQUARE, HOLE]},
    {"type": "MultiPolygon", "coordinates": [[SQUARE], [SQUARE, HOLE]]},
    {"type": "MultiPoint", "coordinates": [[1.0, 2.0], [3.0, 4.0]]},
]


def written(values: list[dict[str, Any]]) -> bytes:
    return flatgeobuf.header("Philips-3.tiff", COLUMNS, len(SHAPES)) + b"".join(
        flatgeobuf.feature(shape, COLUMNS, value)
        for shape, value in zip(SHAPES, values, strict=True)
    )


def test_every_written_shape_and_property_reads_back() -> None:
    values: list[dict[str, Any]] = [
        {"id": f"R{index}", "score": index * 10, "area": index / 4} for index in range(len(SHAPES))
    ]
    features = flatgeobuf.read_features(written(values))
    assert [feature["geometry"] for feature in features] == SHAPES
    assert [feature["properties"] for feature in features] == values


def test_a_missing_property_is_left_out() -> None:
    values: list[dict[str, Any]] = [{"id": "C1", "score": None} for _ in SHAPES]
    features = flatgeobuf.read_features(written(values))
    assert {tuple(feature["properties"].items()) for feature in features} == {(("id", "C1"),)}
