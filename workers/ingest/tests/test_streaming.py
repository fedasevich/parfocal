import io
import json
import random
from pathlib import Path
from typing import Any

import msgspec
import pytest
import shapely

from parfocal_ingest.json_stream import JsonArray, JsonStreamError
from parfocal_ingest.results import (
    ColumnMapping,
    ReadResult,
    ResultObject,
    batch_geometries,
    geometry_of,
    guess_mapping,
    header_of,
    read_geojson,
    read_parfocal_json,
    read_table,
    stream_geojson,
    stream_parfocal_json,
    stream_table,
    table_head,
)

RESULTS = Path(__file__).resolve().parent / "fixtures" / "results"
TEMPLATE = (
    Path(__file__).resolve().parents[3] / "docs" / "reference" / "parfocal-results-v1.template.json"
)
BLOCKS = (1, 3, 64, 1 << 20)
FILE_BLOCKS = (7, 4096, 1 << 20)


def scanned(data: bytes, key: str, block: int) -> tuple[list[Any], Any]:
    scan = JsonArray(io.BytesIO(data), key, block_bytes=block)
    items: list[Any] = []
    for batch in scan.batches():
        items += msgspec.json.decode(batch)
    return items, msgspec.json.decode(bytes(scan.rest))


def random_value(rng: random.Random, depth: int = 0) -> Any:
    pick = rng.random()
    if depth > 3 or pick < 0.3:
        return rng.choice([1, 2.5, None, True, 'a\\"b', "x,]}{[", "\\\\", "", "é", "\\"])
    if pick < 0.6:
        return [random_value(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    keys = ["k", "features", 'a"q', "type"]
    return {rng.choice(keys): random_value(rng, depth + 1) for _ in range(rng.randint(0, 4))}


def test_the_scanner_finds_the_same_items_as_a_whole_decode_at_every_block_size() -> None:
    rng = random.Random(3)
    for _ in range(200):
        items = [random_value(rng) for _ in range(rng.randint(0, 6))]
        document: dict[str, Any] = {"type": "FeatureCollection"}
        if rng.random() < 0.5:
            document["bbox"] = random_value(rng)
        document["features"] = items
        if rng.random() < 0.5:
            document["crs"] = random_value(rng)
        top: Any = document if rng.random() < 0.8 else items
        text = json.dumps(top, indent=rng.choice([None, 1]), ensure_ascii=rng.random() < 0.5)
        for block in BLOCKS:
            found, rest = scanned(text.encode(), "features", block)
            assert found == items
            assert rest == ([] if top is items else {**document, "features": []})


@pytest.mark.parametrize(
    "data",
    [
        b'{"features": [1,,2]}',
        b'{"features": [1,]}',
        b'{"features": [1, 2',
        b'{"features": [1}',
        b"[1, 2] x",
        b"",
    ],
)
def test_broken_json_fails_the_scan_like_a_whole_decode(data: bytes) -> None:
    with pytest.raises(msgspec.DecodeError):
        msgspec.json.decode(data)
    for block in BLOCKS:
        with pytest.raises((JsonStreamError, msgspec.DecodeError)):
            scanned(data, "features", block)


def merged(results: list[ReadResult]) -> ReadResult:
    out = ReadResult()
    for result in results:
        out.objects += result.objects
        out.problems += result.problems
    return out


def described(item: ResultObject) -> tuple[Any, ...]:
    return (
        item.kind,
        item.geometry.geom_type,
        shapely.to_wkb(item.geometry),
        None if item.nucleus is None else shapely.to_wkb(item.nucleus),
        item.class_name,
        item.score,
        item.probabilities,
        item.source_id,
        item.parent,
        item.properties,
    )


def assert_same(old: ReadResult, new: ReadResult) -> None:
    assert new.problems == old.problems
    assert [described(item) for item in new.objects] == [described(item) for item in old.objects]


@pytest.mark.parametrize("name", ["qupath-0.7-cells.geojson", "regions.geojson"])
@pytest.mark.parametrize("block", FILE_BLOCKS)
def test_the_geojson_stream_reads_the_same_objects_as_the_whole_file(name: str, block: int) -> None:
    data = (RESULTS / name).read_bytes()
    streamed = merged(list(stream_geojson(io.BytesIO(data), block_bytes=block)))
    assert_same(read_geojson(data), streamed)


@pytest.mark.parametrize(
    "data",
    [
        b"not json",
        b'{"type": "Topology"}',
        b'{"type": "Topology", "features": []}',
        b'{"type": "Feature", "geometry": 5}',
        b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]}}',
    ],
)
def test_the_geojson_stream_refuses_and_accepts_whole_files_alike(data: bytes) -> None:
    old = read_geojson(data)
    new = merged(list(stream_geojson(io.BytesIO(data))))
    assert [problem.where for problem in new.problems] == [p.where for p in old.problems]
    assert [described(item) for item in new.objects] == [described(item) for item in old.objects]


def test_batched_geometries_equal_one_by_one_shapes() -> None:
    ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    values: list[dict[str, Any] | None] = [
        {"type": "Polygon", "coordinates": [ring]},
        {"type": "Polygon", "coordinates": [ring[:-1]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]]},
        {"type": "Polygon", "coordinates": [ring, [[2, 2], [4, 2], [4, 4], [2, 2]]]},
        {"type": "Polygon", "coordinates": [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2], [0, 0]]]},
        {"type": "MultiPolygon", "coordinates": [[ring], [[[20, 20], [21, 20], [21, 21]]]]},
        {"type": "Point", "coordinates": [3, 4]},
        {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        None,
    ]
    batched = batch_geometries(values)
    for value, found in zip(values, batched, strict=True):
        try:
            expected: Any = None if value is None else geometry_of(value)
        except ValueError as error:
            expected = error
        if value is None or isinstance(expected, Exception):
            assert isinstance(found, Exception)
            assert value is None or str(found) == str(expected)
        else:
            assert isinstance(found, shapely.Geometry)
            assert shapely.to_wkb(found) == shapely.to_wkb(expected)


def test_the_parfocal_stream_reads_the_template_like_the_whole_file() -> None:
    data = TEMPLATE.read_bytes()
    for block in FILE_BLOCKS:
        scan = JsonArray(io.BytesIO(data), "objects", block_bytes=block)
        assert_same(read_parfocal_json(data), merged(list(stream_parfocal_json(scan))))
    wrong = b'{"format": "geojson", "version": 1, "objects": []}'
    streamed = merged(list(stream_parfocal_json(JsonArray(io.BytesIO(wrong), "objects"))))
    assert [problem.where for problem in streamed.problems] == ["file"]


def table_stream(path: Path, mapping: ColumnMapping | None = None) -> ReadResult:
    with path.open(encoding="utf-8-sig", newline="") as text:
        header, dialect = table_head(text)
    with path.open(encoding="utf-8-sig", newline="") as text:
        return merged(
            list(stream_table(text, mapping or guess_mapping(header), dialect, batch_rows=1))
        )


def test_the_table_stream_reads_the_same_rows_as_the_whole_file() -> None:
    tsv = RESULTS / "cells.tsv"
    data = tsv.read_bytes()
    assert_same(read_table(data, guess_mapping(header_of(data))), table_stream(tsv))
    renamed = RESULTS / "cells-renamed.csv"
    mapping = ColumnMapping(
        x="Centroid X px",
        y="Centroid Y px",
        class_name="Cell type",
        score="Confidence",
        source_id="Cell ID",
    )
    assert_same(read_table(renamed.read_bytes(), mapping), table_stream(renamed, mapping))
    with renamed.open(encoding="utf-8-sig", newline="") as text:
        assert table_head(text)[0] == header_of(renamed.read_bytes())


def test_a_table_that_is_not_utf8_is_one_file_problem(tmp_path: Path) -> None:
    path = tmp_path / "cells.csv"
    path.write_bytes(b"x,y\n" + b"1,2\n" * 5000 + b"3,\xff\n")
    mapping = ColumnMapping(x="x", y="y")
    with path.open(encoding="utf-8-sig", newline="") as text:
        _, dialect = table_head(text)
    with path.open(encoding="utf-8-sig", newline="") as text:
        found = merged(list(stream_table(text, mapping, dialect)))
    assert [problem.where for problem in found.problems] == ["file"]
