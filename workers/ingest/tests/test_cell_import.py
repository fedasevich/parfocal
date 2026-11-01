import json
import os
import random
import time
import tracemalloc
import uuid
from pathlib import Path

import numpy as np
import pytest
import shapely

from parfocal_common.cell_chunks import ChunkError, decode
from parfocal_common.chunk_store import BuiltCells, Cell, build_cells
from parfocal_ingest.cell_import import (
    class_key,
    innermost_regions,
    latest_per_number,
    outlines,
    scaled,
)
from parfocal_ingest.chunk_builder import build_table, plan_chunks, table_of_cells
from parfocal_ingest.matching import cell_distance, match_centres, pair_centres
from parfocal_ingest.result_import import (
    NumberedRegion,
    Parsed,
    cell_table,
    class_list,
    objects_to_import,
    read_path,
)
from parfocal_ingest.results import (
    ObjectKind,
    ReadResult,
    ResultObject,
    guess_mapping,
    header_of,
    read_geojson,
    read_table,
)

RESULTS = Path(__file__).resolve().parent / "fixtures" / "results"
QUPATH = RESULTS / "qupath-0.7-cells.geojson"
CELLS_TSV = RESULTS / "cells.tsv"
BOUNDED_CELLS = 100_000
BOUNDED_PEAK_BYTES = 64 * 1024 * 1024
STAND_IN = uuid.UUID(int=0)


def summary_of(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    _, arrays = decode(data)
    numbers = np.asarray(arrays["number"], dtype=np.int64)
    centres = np.column_stack(
        (np.asarray(arrays["x"], dtype=np.float64), np.asarray(arrays["y"], dtype=np.float64))
    )
    return numbers, centres


def test_outlines_keep_points_drop_the_closing_vertex_and_take_the_largest_part() -> None:
    found = outlines(
        [
            shapely.Point(5, 7),
            shapely.box(0, 0, 4, 2),
            shapely.MultiPolygon([shapely.box(0, 0, 1, 1), shapely.box(10, 10, 14, 14)]),
        ]
    )
    assert found.rings[0] == [5.0, 7.0]
    assert len(found.rings[1]) == 8
    assert sorted(zip(found.rings[1][0::2], found.rings[1][1::2], strict=True)) == [
        (0.0, 0.0),
        (0.0, 2.0),
        (4.0, 0.0),
        (4.0, 2.0),
    ]
    assert found.centres.tolist() == [[5.0, 7.0], [2.0, 1.0], [12.0, 12.0]]


def test_a_cell_takes_the_innermost_region_its_centre_lies_in() -> None:
    tissue = shapely.box(0, 0, 1000, 1000)
    nest = shapely.box(100, 100, 300, 300)
    twin = shapely.box(100, 100, 300, 300)
    centres = np.array([[200.0, 200.0], [600.0, 600.0], [1000.0, 500.0], [2000.0, 2000.0]])
    found = innermost_regions(centres, [(1, tissue), (3, twin), (2, nest)])
    assert found.tolist() == [2, 1, 1, 0]
    assert innermost_regions(centres, []).tolist() == [0, 0, 0, 0]


def test_the_latest_set_wins_for_a_number_two_sets_share() -> None:
    numbers = np.array([1, 2, 1, 3], dtype=np.int64)
    centres = np.array([[0.0, 0.0], [5.0, 5.0], [9.0, 9.0], [7.0, 7.0]])
    kept, where = latest_per_number(numbers, centres)
    assert dict(zip(kept.tolist(), map(tuple, where.tolist()), strict=True)) == {
        1: (9.0, 9.0),
        2: (5.0, 5.0),
        3: (7.0, 7.0),
    }


def test_centres_match_one_to_one_and_new_cells_follow_reading_order() -> None:
    known = np.array([7, 9], dtype=np.int64)
    before = np.array([[100.0, 100.0], [400.0, 100.0]])
    after = np.array([[300.0, 50.0], [110.0, 100.0], [102.0, 100.0], [10.0, 50.0]])
    matching = match_centres(known, before, after, distance=16)
    assert matching.inherited == {2: 7}
    assert matching.new == [3, 0, 1]
    assert matching.missing == [9]
    assert matching.numbers(first_new=20) == [21, 22, 7, 20]


def test_a_cell_moved_more_than_four_microns_gets_a_new_number() -> None:
    known = np.array([1], dtype=np.int64)
    before = np.array([[100.0, 100.0]])
    near = match_centres(known, before, np.array([[107.9, 100.0]]), cell_distance(0.5))
    far = match_centres(known, before, np.array([[108.1, 100.0]]), cell_distance(0.5))
    assert (near.inherited, far.inherited) == ({0: 1}, {})


def written(tmp_path: Path, name: str, data: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def parsed_file(tmp_path: Path, name: str, data: bytes, kind: str) -> Parsed:
    parsed = read_path(written(tmp_path, name, data), kind)
    objects_to_import(parsed)
    return parsed


def first_numbers(centres: np.ndarray) -> np.ndarray:
    return pair_centres(np.zeros(0, dtype=np.int64), np.zeros((0, 2)), centres, 16).numbers(1)


def test_a_second_import_of_a_qupath_export_inherits_every_cell_number(tmp_path: Path) -> None:
    parsed = parsed_file(tmp_path, "cells.geojson", QUPATH.read_bytes(), "geojson")
    classes = class_list(parsed)
    regions = [NumberedRegion(1, parsed.shapes[0].geometry)]
    incoming = parsed.cells
    assert len(incoming) == 81
    numbers = first_numbers(incoming.outlines.centres)
    table, dropped = cell_table(incoming, numbers, regions, classes)
    assert not dropped
    assert set(table.region.tolist()) == {1}
    assert table.has_nucleus()
    built = build_table(table, plan_chunks(STAND_IN, STAND_IN, STAND_IN, table, len(classes)))
    known_numbers, known_centres = summary_of(built.summary.data)
    assert sorted(known_numbers.tolist()) == list(range(1, 82))

    again = pair_centres(known_numbers, known_centres, incoming.outlines.centres, 16)
    assert len(again.new) == 0
    assert bool(again.taken.all())
    assert again.numbers(82).tolist() == numbers.tolist()


def test_cells_without_probabilities_drop_the_others(tmp_path: Path) -> None:
    parsed = parsed_file(
        tmp_path,
        "cells.geojson",
        b'{"type": "FeatureCollection", "features": ['
        b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]},'
        b' "properties": {"class": "Tumor", "probabilities": {"Tumor": 0.9}}},'
        b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [5, 6]},'
        b' "properties": {"class": "Other", "score": 0.5}}]}',
        "geojson",
    )
    classes = class_list(parsed)
    table, dropped = cell_table(parsed.cells, np.array([1, 2]), [], classes)
    assert dropped
    assert table.probs is None
    assert (table.class_index.tolist(), table.score.tolist()) == ([0, 1], [0, 128])


def rset_011_class_list(objects: list[ResultObject]) -> list[str]:
    names: dict[str, str] = {}
    seen = [
        *(item.class_name or "" for item in objects),
        *(name for item in objects for name in (item.probabilities or {})),
    ]
    for name in seen:
        key = class_key(name)
        if key is not None and key not in names:
            names[key] = name.strip()[:120]
    return list(names.values())


def rset_011_probabilities(item: ResultObject, classes: list[str]) -> list[int] | None:
    if not item.probabilities:
        return None
    by_key = {class_key(name): value for name, value in item.probabilities.items()}
    return [scaled(by_key.get(class_key(name), 0.0)) or 0 for name in classes]


def rset_011_cells(
    read: ReadResult, regions: list[NumberedRegion]
) -> tuple[list[str], BuiltCells, bool]:
    shapes = [item for item in read.objects if item.kind is not ObjectKind.CELL]
    cells = [item for item in read.objects if item.kind is ObjectKind.CELL]
    classes = rset_011_class_list([*shapes, *cells])
    traced = outlines([item.geometry for item in cells])
    with_nucleus = [index for index, item in enumerate(cells) if item.nucleus]
    nuclei = outlines([item.nucleus for item in cells if item.nucleus])
    nucleus_of = {index: nuclei.ring(i) for i, index in enumerate(with_nucleus)}
    numbers = match_centres(np.zeros(0, dtype=np.int64), np.zeros((0, 2)), traced.centres, 16)
    inside = innermost_regions(traced.centres, [(r.number, r.geometry) for r in regions]).tolist()
    probabilities = [rset_011_probabilities(item, classes) for item in cells]
    keep = all(value is not None for value in probabilities)
    positions = {class_key(name): position for position, name in enumerate(classes)}
    values = [
        Cell(
            number=number,
            ring=traced.ring(index),
            class_index=positions.get(class_key(item.class_name), 255),
            score=scaled(item.score) or 0,
            region=inside[index],
            probs=probabilities[index] if keep else None,
            nucleus=nucleus_of.get(index),
        )
        for index, (item, number) in enumerate(zip(cells, numbers.numbers(1), strict=True))
    ]
    dropped = not keep and any(value is not None for value in probabilities)
    return classes, build_cells(STAND_IN, STAND_IN, STAND_IN, values, len(classes)), dropped


def probability_cells(count: int, *, every: bool) -> bytes:
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [index * 37.5, index * 11.25]},
            "properties": {
                "classification": {"name": ["Tumor", "stroma", "TUMOR "][index % 3]},
                "score": index / count,
                **(
                    {"probabilities": {"Tumor": 0.7, "Stroma": 0.2, "Necrosis": 0.1}}
                    if every or index % 2
                    else {}
                ),
            },
        }
        for index in range(count)
    ]
    return json.dumps({"type": "FeatureCollection", "features": features}).encode()


@pytest.mark.parametrize(
    ("name", "data", "kind"),
    [
        ("qupath.geojson", QUPATH.read_bytes(), "geojson"),
        ("cells.tsv", CELLS_TSV.read_bytes(), "csv"),
        ("all.geojson", probability_cells(300, every=True), "geojson"),
        ("some.geojson", probability_cells(300, every=False), "geojson"),
    ],
)
def test_the_streaming_import_writes_the_same_chunks_as_the_whole_file_import(
    tmp_path: Path, name: str, data: bytes, kind: str
) -> None:
    parsed = parsed_file(tmp_path, name, data, kind)
    regions = [
        NumberedRegion(number, shape.geometry)
        for number, shape in enumerate(parsed.shapes, start=1)
    ]
    whole = (
        read_geojson(data)
        if kind == "geojson"
        else read_table(data, guess_mapping(header_of(data)))
    )
    classes, expected, expected_dropped = rset_011_cells(whole, regions)
    assert class_list(parsed) == classes
    numbers = first_numbers(parsed.cells.outlines.centres)
    table, dropped = cell_table(parsed.cells, numbers, regions, classes)
    built = build_table(table, plan_chunks(STAND_IN, STAND_IN, STAND_IN, table, len(classes)))
    assert dropped == expected_dropped
    assert built.entries == expected.entries
    assert [item.data for item in built.chunks] == [item.data for item in expected.chunks]
    assert built.summary.data == expected.summary.data


def test_the_chunk_builder_writes_the_same_bytes_as_the_chunk_store() -> None:
    rng = random.Random(5)
    for classes, probs, alt, nucleus in [
        (0, False, False, False),
        (5, True, True, True),
        (3, False, True, False),
        (4, True, False, True),
    ]:
        cells = []
        for number in rng.sample(range(1, 10**6), 400):
            x, y = rng.uniform(-3000, 12000), rng.uniform(-3000, 12000)
            ring = [
                float(np.float32(value))
                for _ in range(rng.randint(1, 30))
                for value in (x + rng.uniform(-9, 9), y + rng.uniform(-9, 9))
            ]
            cells.append(
                Cell(
                    number=number,
                    ring=ring,
                    class_index=rng.choice([255, *range(classes)]),
                    score=rng.randint(0, 255),
                    flags=rng.randint(0, 3),
                    region=rng.randint(0, 9),
                    probs=[rng.randint(0, 255) for _ in range(classes)] if probs else None,
                    alt_class=rng.choice([None, *range(classes)]) if alt and classes else None,
                    nucleus=ring[:6] if nucleus and rng.random() < 0.7 else None,
                )
            )
        expected = build_cells(STAND_IN, STAND_IN, STAND_IN, cells, classes)
        table = table_of_cells(cells)
        built = build_table(table, plan_chunks(STAND_IN, STAND_IN, STAND_IN, table, classes))
        assert built.entries == expected.entries
        assert [item.data for item in built.chunks] == [item.data for item in expected.chunks]
        assert built.summary.data == expected.summary.data


@pytest.mark.parametrize(
    ("cells", "message"),
    [
        (
            [Cell(number=0, ring=[1.0, 2.0])],
            "Cell C0 cannot be stored, because its number is out of range",
        ),
        (
            [Cell(number=1, ring=[1.0, 2.0]), Cell(number=1, ring=[3.0, 4.0])],
            "Cell C1 appears twice",
        ),
        (
            [Cell(number=2, ring=[float("nan"), 2.0])],
            "Cell C2 cannot be stored, because its outline has a value that is not a number",
        ),
        (
            [Cell(number=3, ring=[1.0, 2.0], class_index=4)],
            "Cell C3 cannot be stored, because its class 4 is not one of 2 classes",
        ),
    ],
)
def test_the_chunk_builder_refuses_what_the_chunk_store_refuses(
    cells: list[Cell], message: str
) -> None:
    with pytest.raises(ChunkError, match=message):
        build_cells(STAND_IN, STAND_IN, STAND_IN, cells, 2)
    with pytest.raises(ChunkError, match=message):
        plan_chunks(STAND_IN, STAND_IN, STAND_IN, table_of_cells(cells), 2)


def generated_cells(path: Path, count: int) -> None:
    side = int(np.ceil(np.sqrt(count)))
    angles = np.linspace(0, 2 * np.pi, 8, endpoint=False)
    shape = np.column_stack((np.cos(angles), np.sin(angles))) * 6.0
    with path.open("w") as handle:
        handle.write('{"type":"FeatureCollection","features":[')
        for index in range(count):
            ring = shape + np.array([(index % side) * 30.0, (index // side) * 30.0])
            coords = ",".join(f"[{x:.2f},{y:.2f}]" for x, y in ring.tolist())
            first = f"[{ring[0, 0]:.2f},{ring[0, 1]:.2f}]"
            handle.write(
                ("," if index else "")
                + '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[['
                + f'{coords},{first}]]}},"properties":{{"objectType":"cell",'
                + f'"classification":{{"name":"type-{index % 5}"}},"score":0.5}}}}'
            )
        handle.write("]}")


def test_reading_100000_cells_stays_within_a_bounded_python_heap(tmp_path: Path) -> None:
    path = tmp_path / "cells.geojson"
    generated_cells(path, BOUNDED_CELLS)
    tracemalloc.start()
    try:
        parsed = read_path(path, "geojson")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert len(parsed.cells) == BOUNDED_CELLS
    assert peak < BOUNDED_PEAK_BYTES, (peak, path.stat().st_size)


@pytest.mark.parametrize("count", [int(os.environ.get("CELL_IMPORT_CELLS", "200000"))])
def test_matching_a_large_slide_is_not_quadratic(count: int) -> None:
    generator = np.random.default_rng(7)
    side = int(np.ceil(np.sqrt(count)))
    grid = np.stack(np.meshgrid(np.arange(side), np.arange(side)), axis=-1).reshape(-1, 2)
    before = grid[:count].astype(np.float64) * 40.0
    after = before + generator.uniform(-3.0, 3.0, size=before.shape)
    numbers = np.arange(1, count + 1, dtype=np.int64)
    started = time.perf_counter()
    matching = match_centres(numbers, before, after, 16)
    elapsed = time.perf_counter() - started
    assert len(matching.inherited) == count
    assert matching.numbers(count + 1) == numbers.tolist()
    assert elapsed < count * 10e-6
