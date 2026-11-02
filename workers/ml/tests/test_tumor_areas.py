import base64
import json
import math
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.tumor_areas import (
    Category,
    LikelySize,
    category_of,
    convex_hull,
    crosses_a_line,
    diameter,
    evaluate_areas,
    find_tumor_areas,
    likely_size,
)

POC_MAPS = Path("/Users/yuriifedas/WebstormProjects/poc/public/data")
EVEN = LikelySize(0.1, 0.1, "test")


def grid(rows: list[str]) -> np.ndarray:
    levels = {".": 0.0, "o": 0.6, "#": 0.99}
    return np.array([[levels[mark] for mark in row] for row in rows])


def areas_of(rows: list[str], cell_px: float = 100, um_per_px: float = 1.0):
    values = grid(rows)
    extent = (0.0, 0.0, values.shape[1] * cell_px, values.shape[0] * cell_px)
    return find_tumor_areas(values, extent, um_per_px, size=EVEN)


def test_cells_touching_at_a_corner_join_one_area():
    areas = areas_of(["#...", ".#..", "..o.", "...."])
    assert [area.cells for area in areas] == [3]


def test_cells_apart_form_separate_areas():
    areas = areas_of(["#.#", "...", "#.."])
    assert len(areas) == 3


def test_cells_below_the_outline_threshold_are_left_out():
    values = np.array([[0.99, 0.49], [0.0, 0.0]])
    areas = find_tumor_areas(values, (0, 0, 200, 200), 1.0, size=EVEN)
    assert [area.cells for area in areas] == [1]


def test_an_area_needs_its_peak_to_reach_the_listing_level():
    assert areas_of(["oo..", "....", "..o#"])[0].cells == 2
    assert len(areas_of(["oo..", "....", "..o#"])) == 1
    values = np.array([[0.969, 0.6], [0.0, 0.97]])
    areas = find_tumor_areas(values, (0, 0, 200, 200), 1.0, size=EVEN)
    assert [area.cells for area in areas] == [3]
    values = np.array([[0.969, 0.6], [0.0, 0.0]])
    assert find_tumor_areas(values, (0, 0, 200, 200), 1.0, size=EVEN) == []


def test_the_peak_filter_keeps_the_whole_outline():
    areas = areas_of(["oooo#"])
    assert areas[0].cells == 5
    assert areas[0].longest_mm == pytest.approx(math.hypot(500, 100) / 1000)


def test_an_empty_map_has_no_areas():
    assert find_tumor_areas(np.zeros((3, 3)), (0, 0, 3, 3), 1.0, size=EVEN) == []


def test_hull_drops_inner_and_collinear_points():
    square = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (1.0, 1.0), (1.0, 0.0)]
    assert sorted(convex_hull(square)) == [(0.0, 0.0), (0.0, 2.0), (2.0, 0.0), (2.0, 2.0)]


def test_diameter_is_the_widest_distance_across_the_hull():
    assert diameter(convex_hull([(0.0, 0.0), (3.0, 0.0), (3.0, 4.0), (1.0, 1.0)])) == 5.0
    assert diameter([(1.0, 1.0)]) == 0.0


def test_size_is_the_hull_diameter_of_the_cells_in_mm():
    area = areas_of(["#....", ".#...", "..#.."], cell_px=100, um_per_px=2.0)[0]
    assert area.longest_mm == pytest.approx(math.hypot(300, 300) * 2.0 / 1000)
    l_shape = areas_of(["#..", "#..", "###"], cell_px=100, um_per_px=1.0)[0]
    assert l_shape.longest_mm == pytest.approx(math.hypot(300, 300) / 1000)


def test_cell_size_follows_the_extent_on_each_axis():
    values = np.array([[0.99, 0.99]])
    area = find_tumor_areas(values, (1000, 2000, 1400, 2100), 1.0, size=EVEN)[0]
    assert area.longest_mm == pytest.approx(math.hypot(400, 100) / 1000)
    assert area.box == (1000, 2000, 1400, 2100)
    assert area.centre == (1200, 2050)
    assert area.area_mm2 == pytest.approx(400 * 100 / 1e6)


@pytest.mark.parametrize(
    ("longest_mm", "tumor_cells", "expected"),
    [
        (2.01, None, Category.MACRO),
        (2.0, None, Category.MICRO),
        (0.21, None, Category.MICRO),
        (0.2, None, Category.ITC),
        (0.2, 200, Category.ITC),
        (0.2, 201, Category.MICRO),
        (0.05, None, Category.ITC),
    ],
)
def test_category_lines(longest_mm, tumor_cells, expected):
    assert category_of(longest_mm, tumor_cells) is expected


@pytest.mark.parametrize(
    ("likely", "near"),
    [
        ((0.18, 0.22), True),
        ((0.2, 0.25), True),
        ((0.15, 0.2), False),
        ((1.9, 2.1), True),
        ((0.5, 1.5), False),
        ((2.1, 2.5), False),
    ],
)
def test_near_a_line_when_the_likely_range_crosses_one(likely, near):
    assert crosses_a_line(likely) is near


def test_an_area_carries_its_range_category_and_flags():
    area = areas_of(["##"], cell_px=90, um_per_px=1.0)[0]
    assert area.longest_mm == pytest.approx(math.hypot(180, 90) / 1000)
    assert area.likely_mm == pytest.approx((area.longest_mm * 0.9, area.longest_mm * 1.1))
    assert area.category is Category.MICRO
    assert area.near_line
    assert not area.too_small_for_map
    speck = areas_of(["#"], cell_px=100, um_per_px=1.0)[0]
    assert speck.category is Category.ITC
    assert speck.too_small_for_map


def test_areas_come_largest_first_then_by_peak():
    values = np.zeros((5, 9))
    values[0, 0] = 0.98
    values[0, 4] = 0.99
    values[2:5, 6:9] = 0.97
    areas = find_tumor_areas(values, (0, 0, 900, 500), 1.0, size=EVEN)
    assert [(area.cells, area.peak) for area in areas] == [(9, 0.97), (1, 0.99), (1, 0.98)]


def test_the_range_comes_from_the_packaged_config():
    size = likely_size()
    assert (size.below, size.above) == (0.1, 0.1)
    assert size.source.startswith("TODO")
    assert size.around(1.0) == pytest.approx((0.9, 1.1))


def test_evaluation_matches_deposits_and_counts_stray_areas():
    values = np.zeros((4, 10))
    values[0, 0:3] = 0.99
    values[3, 9] = 0.99
    areas = find_tumor_areas(values, (0, 0, 1000, 400), 1.0, size=EVEN)
    outlines = [
        [(0.0, 0.0), (300.0, 0.0), (300.0, 100.0), (0.0, 100.0)],
        [(500.0, 300.0), (520.0, 300.0), (520.0, 320.0)],
    ]
    result = evaluate_areas(areas, outlines, 1.0, pad=0)
    assert [(match.found_mm is not None, match.areas) for match in result.deposits] == [
        (True, 1),
        (False, 0),
    ]
    assert result.deposits[0].error_mm == pytest.approx(0.0)
    assert [area.cells for area in result.stray] == [1]


@pytest.mark.skipif(
    not (POC_MAPS / "heatmaps/tumor_009.tumor.json").exists(), reason="the POC is not checked out"
)
def test_reproduces_the_poc_on_tumor_009():
    stored = json.loads((POC_MAPS / "heatmaps/tumor_009.tumor.json").read_text())
    values = np.frombuffer(base64.b64decode(stored["values"]), dtype=np.uint8)
    values = (
        values[: stored["width"] * stored["height"]].reshape(stored["height"], stored["width"])
        / 255
    )
    um_per_px = 0.2439
    areas = find_tumor_areas(values, tuple(stored["extent"]), um_per_px)
    truth = json.loads((POC_MAPS / "camelyon/Tumor_009.json").read_text())["positive"]
    result = evaluate_areas(
        areas, [[tuple(p) for p in t["vertices"]] for t in truth], um_per_px, stored["cell"]
    )
    assert len(areas) == 7
    assert round(areas[0].longest_mm, 1) == 8.1
    assert round(result.deposits[0].truth_mm, 1) == 8.1
    assert all(match.found_mm is not None for match in result.deposits)
