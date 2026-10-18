import json
from pathlib import Path
from typing import Any

import pytest
import shapely
from shapely.geometry.base import BaseGeometry

from parfocal_ingest.matching import (
    Known,
    Matching,
    cell_distance,
    match_cells,
    match_regions,
)

SETS = Path(__file__).resolve().parent / "fixtures" / "sets"


def loaded(name: str) -> dict[str, Any]:
    return json.loads((SETS / f"{name}.json").read_text())


def known(items: list[dict[str, Any]]) -> list[Known]:
    return [Known(item["number"], shapely.from_wkt(item["wkt"])) for item in items]


def shapes(items: list[dict[str, Any]]) -> list[BaseGeometry]:
    return [shapely.from_wkt(item["wkt"]) for item in items]


def test_regions_inherit_by_overlap_and_new_ones_continue_the_counter() -> None:
    first, second = loaded("first"), loaded("second")
    matching = match_regions(known(first["regions"]), shapes(second["regions"]))
    assert matching.inherited == {0: 1}
    assert matching.new == [2, 1]
    assert matching.missing == [2, 3]
    assert matching.numbers(first_new=4) == [1, 5, 4]
    assert second["regions"][0]["class"] != first["regions"][0]["class"]


def test_cells_inherit_within_four_microns() -> None:
    first, second = loaded("first"), loaded("second")
    distance = cell_distance(second["mpp"])
    assert distance == 16
    matching = match_cells(known(first["cells"]), shapes(second["cells"]), distance)
    assert matching.inherited == {0: 1, 2: 3}
    assert (matching.new, matching.missing) == ([1], [2])
    assert matching.numbers(first_new=4) == [1, 4, 3]


def test_matching_is_one_to_one_and_the_closest_wins() -> None:
    before = [Known(7, shapely.Point(100, 100))]
    after = [shapely.Point(110, 100), shapely.Point(102, 100)]
    matching = match_cells(before, after, distance=16)
    assert matching.inherited == {1: 7}
    assert matching.new == [0]
    squares = [Known(1, shapely.box(0, 0, 10, 10))]
    regions = match_regions(squares, [shapely.box(0, 0, 9, 10), shapely.box(0, 0, 10, 10)])
    assert regions.inherited == {1: 1}


@pytest.mark.parametrize(("mpp", "pixels"), [(0.25, 16.0), (0.5, 8.0), (None, 16.0), (0.0, 16.0)])
def test_the_cell_distance_follows_the_pixel_size(mpp: float | None, pixels: float) -> None:
    assert cell_distance(mpp) == pixels


def test_a_first_import_numbers_everything_as_new() -> None:
    second = loaded("second")
    regions = match_regions([], shapes(second["regions"]))
    assert regions == Matching(inherited={}, new=[0, 2, 1], missing=[])
    assert regions.numbers(first_new=1) == [1, 3, 2]
    cells = match_cells([], shapes(second["cells"]), distance=16)
    assert cells.numbers(first_new=1) == [2, 3, 1]
