import os
import time
import uuid
from pathlib import Path

import numpy as np
import pytest
import shapely

from parfocal_common.cell_chunks import decode
from parfocal_common.chunk_store import build_cells
from parfocal_ingest.cell_import import innermost_regions, latest_per_number, outlines
from parfocal_ingest.matching import cell_distance, match_centres
from parfocal_ingest.result_import import (
    IncomingCells,
    NumberedRegion,
    cell_values,
    class_list,
    incoming_cells,
    objects_to_import,
    read_file,
)

QUPATH = Path(__file__).resolve().parent / "fixtures" / "results" / "qupath-0.7-cells.geojson"
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


def qupath_cells() -> tuple[list[str], list[NumberedRegion], IncomingCells]:
    parsed = read_file(QUPATH.read_bytes(), "geojson")
    shapes, cells = objects_to_import(parsed)
    classes = class_list(parsed, [*shapes, *cells])
    regions = [NumberedRegion(1, shapes[0].geometry)]
    return classes, regions, incoming_cells(cells)


def test_a_second_import_of_a_qupath_export_inherits_every_cell_number() -> None:
    classes, regions, incoming = qupath_cells()
    assert len(incoming) == 81
    first = match_centres(
        np.zeros(0, dtype=np.int64), np.zeros((0, 2)), incoming.outlines.centres, 16
    )
    cells, dropped = cell_values(incoming, first.numbers(1), regions, classes)
    assert not dropped
    assert {cell.region for cell in cells} == {1}
    assert all(cell.nucleus for cell in cells)
    built = build_cells(STAND_IN, STAND_IN, STAND_IN, cells, len(classes))
    known_numbers, known_centres = summary_of(built.summary.data)
    assert sorted(known_numbers.tolist()) == list(range(1, 82))

    again = match_centres(known_numbers, known_centres, incoming.outlines.centres, 16)
    assert again.new == []
    assert again.missing == []
    assert again.numbers(82) == first.numbers(1)


def test_cells_without_probabilities_drop_the_others() -> None:
    parsed = read_file(
        b'{"type": "FeatureCollection", "features": ['
        b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]},'
        b' "properties": {"class": "Tumor", "probabilities": {"Tumor": 0.9}}},'
        b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [5, 6]},'
        b' "properties": {"class": "Other", "score": 0.5}}]}',
        "geojson",
    )
    _, cells = objects_to_import(parsed)
    classes = class_list(parsed, cells)
    values, dropped = cell_values(incoming_cells(cells), [1, 2], [], classes)
    assert dropped
    assert [(cell.class_index, cell.score, cell.probs) for cell in values] == [
        (0, 0, None),
        (1, 128, None),
    ]


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
