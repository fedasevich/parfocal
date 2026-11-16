import math

import numpy as np
import pytest

from parfocal_common.node_staging import CELL_LIMIT, Area, Call, Category, stage_node
from parfocal_ml.area_count import (
    MapTooCoarseError,
    UntypedNucleusError,
    count_in_map_area,
    count_in_outline,
    inside_outline,
)
from parfocal_ml.cell_areas import TypedCell
from parfocal_ml.tumor_areas import LikelySize, area_labels, find_tumor_areas
from parfocal_ml.type_evaluation import scaled

MPP = 0.25
EVEN = LikelySize(0.1, 0.1, "test")
STEP = 10 / MPP


def tumor(x: float, y: float, p: float) -> TypedCell:
    return TypedCell(x, y, "tumor", {"tumor": p, "stroma": (1 - p) / 2, "immune": (1 - p) / 2})


def stroma(x: float, y: float, p: float) -> TypedCell:
    return TypedCell(x, y, "stroma", {"tumor": p, "stroma": 1 - p - 0.05, "immune": 0.05})


def cluster(
    rng: np.random.Generator, cx: float, cy: float, nuclei: int, low: float, high: float
) -> list[TypedCell]:
    side = math.ceil(math.sqrt(nuclei))
    cells: list[TypedCell] = []
    for index in range(nuclei):
        row, col = divmod(index, side)
        x = cx + (col - side / 2) * STEP + rng.uniform(-5, 5)
        y = cy + (row - side / 2) * STEP + rng.uniform(-5, 5)
        cells.append(tumor(x, y, float(rng.uniform(low, high))))
    return cells


def square(cx: float, cy: float, half: float) -> list[tuple[float, float]]:
    return [
        (cx - half, cy - half),
        (cx + half, cy - half),
        (cx + half, cy + half),
        (cx - half, cy + half),
    ]


def expected_range(cells: list[TypedCell]) -> tuple[float, int, float]:
    called = [cell.probabilities["tumor"] for cell in cells if cell.type == "tumor"]
    others = [cell.probabilities["tumor"] for cell in cells if cell.type != "tumor"]
    return sum(called), len(called), len(called) + sum(others)


def test_a_seeded_cluster_counts_its_tumor_calls_with_the_expected_mistakes_range():
    rng = np.random.default_rng(3)
    inside = cluster(rng, 5000, 5000, 60, 0.6, 0.99)
    inside += [stroma(5000 + dx, 5000 + dy, 0.3) for dx, dy in ((-40, 0), (40, 0), (0, 40))]
    outside = [*cluster(rng, 9000, 9000, 40, 0.9, 0.99), tumor(5000, 5000 - 210, 0.99)]
    cells = outside[:20] + inside + outside[20:]

    result = count_in_outline(cells, square(5000, 5000, 200))

    low, calls, high = expected_range(inside)
    assert result.nuclei == len(inside)
    assert result.tumor_calls == calls == 60
    assert result.count.low == pytest.approx(low)
    assert result.count.value == calls
    assert result.count.high == pytest.approx(high)
    assert result.count.low < result.count.value < result.count.high
    assert result.firm


def test_a_concave_outline_leaves_out_nuclei_in_its_notch():
    outline = [
        (0.0, 0.0),
        (400.0, 0.0),
        (400.0, 400.0),
        (200.0, 400.0),
        (200.0, 200.0),
        (0.0, 200.0),
    ]
    cells = [tumor(100, 100, 0.9), tumor(300, 300, 0.9), tumor(100, 300, 0.9), tumor(300, 100, 0.9)]

    result = count_in_outline(cells, outline)

    assert result.members == (0, 1, 3)
    assert inside_outline(
        outline[::-1], np.array([100.0, 100.0]), np.array([100.0, 300.0])
    ).tolist() == [
        True,
        False,
    ]


def test_counts_under_over_and_across_two_hundred_settle_only_when_firm():
    rng = np.random.default_rng(11)
    small = count_in_outline(cluster(rng, 0, 0, 120, 0.7, 0.99), square(0, 0, 400))
    large = count_in_outline(cluster(rng, 0, 0, 260, 0.95, 0.99), square(0, 0, 700))
    near = cluster(rng, 0, 0, 190, 0.85, 0.95)
    near += [stroma(x, y, 0.4) for x, y in [(1200.0 + 15 * i, 0.0) for i in range(40)]]
    across = count_in_outline(near, square(600, 0, 1400))

    assert small.count.high <= CELL_LIMIT
    assert small.firm
    assert large.count.low > CELL_LIMIT
    assert large.firm
    assert across.count.low < CELL_LIMIT < across.count.high
    assert not across.firm


def test_the_cells_feed_node_staging_for_a_small_cluster():
    rng = np.random.default_rng(5)
    result = count_in_outline(cluster(rng, 0, 0, 260, 0.95, 0.99), square(0, 0, 700))

    stage = stage_node([Area("a", 0.15, Call.TUMOR, 0.15, result.cells)])

    assert stage.needs_count
    assert stage.count == result.count
    assert stage.category == Category.MICRO


def test_reviewed_nuclei_count_as_certain():
    cells = [tumor(0, 0, 0.6), tumor(40, 0, 0.6), stroma(80, 0, 0.3)]

    result = count_in_outline(cells, square(40, 0, 100), reviewed={0: True, 1: False, 2: True})

    assert (result.count.low, result.count.value, result.count.high) == (2, 2, 2)


def test_the_range_uses_the_calibrated_probabilities():
    cells = [tumor(0, 0, 0.9), stroma(40, 0, 0.3)]
    temperature = 1.8
    called = scaled(np.array([[0.9, 0.05, 0.05]]), temperature)[0, 0]
    other = scaled(np.array([[0.3, 0.65, 0.05]]), temperature)[0, 0]

    result = count_in_outline(cells, square(20, 0, 100), temperature=temperature)

    assert result.count.low == pytest.approx(called)
    assert result.count.high == pytest.approx(1 + other)
    assert result.count.low < 0.9


def test_a_nucleus_without_a_tumor_probability_is_refused_not_counted_as_certain():
    cells = [TypedCell(0, 0, "tumor", {})]

    with pytest.raises(UntypedNucleusError):
        count_in_outline(cells, square(0, 0, 50))


def fine_map(origin: tuple[float, float]) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    grid = np.zeros((10, 10))
    grid[2, 2] = grid[2, 3] = grid[3, 3] = 0.99
    grid[7, 7] = 0.98
    extent = (origin[0], origin[1], origin[0] + 640.0, origin[1] + 640.0)
    return grid, extent


def centre_of(
    row: int, col: int, origin: tuple[float, float], cell: float = 64.0
) -> tuple[float, float]:
    return origin[0] + (col + 0.5) * cell, origin[1] + (row + 0.5) * cell


def test_a_map_area_counts_nuclei_in_its_own_cells_not_its_box():
    origin = (10_000.0, 20_000.0)
    grid, extent = fine_map(origin)
    areas = find_tumor_areas(grid, extent, MPP, size=EVEN)
    labels, _ = area_labels(grid)
    lead = next(area for area in areas if area.cells == 3)
    cells = [
        tumor(*centre_of(2, 2, origin), 0.9),
        tumor(*centre_of(2, 3, origin), 0.8),
        stroma(*centre_of(3, 3, origin), 0.2),
        tumor(*centre_of(3, 2, origin), 0.95),
        tumor(*centre_of(7, 7, origin), 0.95),
        tumor(origin[0] + 4 * 64 + 1, origin[1] + 2 * 64 + 1, 0.9),
    ]

    result = count_in_map_area(cells, lead, labels, extent)

    assert lead.longest_mm <= 0.2
    assert result.members == (0, 1, 2)
    assert result.count.value == 2
    assert result.count.low == pytest.approx(1.7)
    assert result.count.high == pytest.approx(2.2)


def test_a_small_area_on_the_coarse_map_is_refused():
    grid = np.zeros((4, 4))
    grid[1, 1] = 0.99
    extent = (0.0, 0.0, 1024.0, 1024.0)
    area = find_tumor_areas(grid, extent, MPP, size=EVEN)[0]
    labels, _ = area_labels(grid)

    assert area.longest_mm <= 0.2
    with pytest.raises(MapTooCoarseError):
        count_in_map_area([tumor(384, 384, 0.9)], area, labels, extent)


def test_a_large_area_on_the_coarse_map_is_still_counted():
    grid = np.zeros((8, 8))
    grid[1:6, 1:6] = 0.99
    extent = (0.0, 0.0, 2048.0, 2048.0)
    area = find_tumor_areas(grid, extent, MPP, size=EVEN)[0]
    labels, _ = area_labels(grid)

    result = count_in_map_area([tumor(384, 384, 0.9), tumor(1900, 1900, 0.9)], area, labels, extent)

    assert area.longest_mm > 0.2
    assert result.members == (0,)
