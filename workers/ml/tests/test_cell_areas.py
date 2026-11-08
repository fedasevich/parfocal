import math
from dataclasses import replace

import numpy as np
import pytest

from parfocal_ml.cell_areas import CellArea, TypedCell, find_cell_areas, inside_hull
from parfocal_ml.tumor_areas import Category, LikelySize

MPP = 0.25
EVEN = LikelySize(0.1, 0.1, "test")
NESTS = ((2000.0, 2000.0, 60.0), (6000.0, 3000.0, 35.0), (3000.0, 7000.0, 20.0))


def nest(rng: np.random.Generator, cx: float, cy: float, radius_um: float) -> list[TypedCell]:
    step = 10 / MPP
    reach = int(radius_um / 10)
    cells: list[TypedCell] = []
    for row in range(-reach, reach + 1):
        for col in range(-reach, reach + 1):
            if math.hypot(row, col) * 10 > radius_um:
                continue
            x, y = cx + col * step, cy + row * step
            x, y = x + rng.uniform(-8, 8), y + rng.uniform(-8, 8)
            tumor = float(rng.uniform(0.6, 0.99))
            if (row + col) % 7 == 0:
                cells.append(TypedCell(x, y, "immune", {"tumor": 1 - tumor, "immune": tumor}, 30))
            else:
                cells.append(TypedCell(x, y, "tumor", {"tumor": tumor, "stroma": 1 - tumor}, 30))
    return cells


def fixture_cells(seed: int = 7) -> list[TypedCell]:
    rng = np.random.default_rng(seed)
    cells = [cell for cx, cy, radius in NESTS for cell in nest(rng, cx, cy, radius)]
    for x, y in rng.uniform(0, 9000, size=(400, 2)):
        cells.append(TypedCell(float(x), float(y), "stroma", {"stroma": 0.9, "tumor": 0.1}, 30))
    for x, y in ((8500.0, 500.0), (500.0, 8500.0), (8500.0, 8500.0)):
        cells.append(TypedCell(x, y, "tumor", {"tumor": 0.9, "stroma": 0.1}, 30))
    return cells


def areas_of(
    cells: list[TypedCell], kind: str = "tumor", link_um: float = 20.0, min_cells: int = 3
) -> list[CellArea]:
    return find_cell_areas(cells, MPP, kind=kind, link_um=link_um, min_cells=min_cells, size=EVEN)


def summary(areas: list[CellArea], cells: list[TypedCell]) -> list[frozenset[tuple[float, float]]]:
    return [frozenset((cells[i].x, cells[i].y) for i in area.members) for area in areas]


def tumor_in_nest(cells: list[TypedCell], cx: float, cy: float, radius_um: float) -> int:
    reach = (radius_um + 5) / MPP
    return sum(
        cell.type == "tumor" and math.hypot(cell.x - cx, cell.y - cy) <= reach for cell in cells
    )


def test_the_fixture_gives_one_area_per_seeded_nest():
    cells = fixture_cells()
    areas = areas_of(cells)
    assert len(areas) == len(NESTS)
    for area, (cx, cy, radius) in zip(areas, NESTS, strict=True):
        assert area.typed_cells == tumor_in_nest(cells, cx, cy, radius)
        assert area.centre == pytest.approx((cx, cy), abs=40)
        assert area.other_cells > 0
        assert 0.5 < area.share < 1


def test_scattered_tumor_cells_stay_out_of_areas():
    cells = fixture_cells()
    members = {index for area in areas_of(cells) for index in area.members}
    assert all(cells[index].type == "tumor" for index in members)
    assert len(cells) - 3 not in members
    assert len(cells) - 1 not in members


def test_areas_do_not_depend_on_input_order():
    cells = fixture_cells()
    shuffled = [cells[i] for i in np.random.default_rng(3).permutation(len(cells))]
    first, second = areas_of(cells), areas_of(shuffled)
    assert summary(first, cells) == summary(second, shuffled)
    for a, b in zip(first, second, strict=True):
        assert a.longest_mm == pytest.approx(b.longest_mm)
        assert a.area_mm2 == pytest.approx(b.area_mm2)
        assert a.other_cells == b.other_cells


def test_moving_the_slide_moves_the_areas_and_nothing_else():
    cells = fixture_cells()
    moved = [replace(cell, x=cell.x + 12345.5, y=cell.y - 777.25) for cell in cells]
    for a, b in zip(areas_of(cells), areas_of(moved), strict=True):
        assert a.members == b.members
        assert b.centre == pytest.approx((a.centre[0] + 12345.5, a.centre[1] - 777.25))
        assert b.box[0] == pytest.approx(a.box[0] + 12345.5)
        assert b.longest_mm == pytest.approx(a.longest_mm)
        assert b.area_mm2 == pytest.approx(a.area_mm2)


def test_a_micron_of_jitter_keeps_every_area():
    cells = fixture_cells()
    rng = np.random.default_rng(11)
    shaken = [
        replace(cell, x=cell.x + dx, y=cell.y + dy)
        for cell, (dx, dy) in zip(
            cells, rng.uniform(-1 / MPP, 1 / MPP, (len(cells), 2)), strict=True
        )
    ]
    first, second = areas_of(cells), areas_of(shaken)
    assert [area.members for area in first] == [area.members for area in second]
    for a, b in zip(first, second, strict=True):
        assert b.longest_mm == pytest.approx(a.longest_mm, rel=0.05)


def test_two_seeds_of_the_fixture_give_the_same_areas():
    counts = [[area.typed_cells for area in areas_of(fixture_cells(seed))] for seed in (7, 8)]
    assert counts[0] == counts[1]


def test_expected_cells_add_the_type_probabilities():
    cells = fixture_cells()
    for area in areas_of(cells):
        total = sum(cells[i].probabilities["tumor"] for i in area.members)
        assert area.expected_cells == pytest.approx(total)
        assert area.expected_cells < area.typed_cells


def test_a_lone_cell_is_an_itc_as_wide_as_its_nucleus():
    cells = [TypedCell(100, 100, "tumor", {"tumor": 0.8}, 40)]
    [area] = areas_of(cells, min_cells=1)
    assert area.longest_mm == pytest.approx(40 * MPP / 1000)
    assert area.area_mm2 == pytest.approx(math.pi * (20 * MPP) ** 2 / 1e6)
    assert area.category is Category.ITC
    assert areas_of(cells) == []


def test_two_cells_have_a_width_and_an_area():
    cells = [TypedCell(0, 0, "tumor", {}, 20), TypedCell(60, 0, "tumor", {}, 20)]
    [area] = areas_of(cells, min_cells=2)
    assert area.longest_mm == pytest.approx(80 * MPP / 1000)
    assert area.area_mm2 == pytest.approx((60 * 20 + math.pi * 100) * MPP**2 / 1e6)


def test_cells_further_apart_than_the_link_stay_apart():
    near = [TypedCell(x, 0, "tumor") for x in (0, 79, 158)]
    far = [TypedCell(x, 0, "tumor") for x in (0, 81, 162)]
    assert len(areas_of(near, min_cells=1)) == 1
    assert len(areas_of(far, min_cells=1)) == 3


def test_over_two_hundred_tumor_cells_make_a_micrometastasis_even_when_small():
    cells = [
        TypedCell(col * 8 / MPP, row * 8 / MPP, "tumor") for row in range(16) for col in range(16)
    ]
    [area] = areas_of(cells)
    assert area.longest_mm < 0.2
    assert area.category is Category.MICRO
    assert areas_of(cells[:150])[0].category is Category.ITC


def test_other_types_group_without_a_staging_category():
    cells = fixture_cells()
    areas = areas_of(cells, kind="immune", link_um=30)
    assert areas
    assert all(area.category is None for area in areas)
    assert all(cells[i].type == "immune" for area in areas for i in area.members)


def test_no_cells_give_no_areas():
    assert areas_of([]) == []
    assert areas_of([TypedCell(0, 0, "stroma")]) == []


def test_the_hull_test_counts_only_cells_inside():
    square = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0))
    xs = np.array([5.0, 15.0, 0.0, -1.0])
    ys = np.array([5.0, 5.0, 5.0, 5.0])
    assert inside_hull(square, xs, ys).tolist() == [True, False, True, False]
