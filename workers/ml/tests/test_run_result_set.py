import uuid

import numpy as np
import pytest

from parfocal_common.chunk_store import Cell, cells_in, chunk_of, summary_of
from parfocal_common.jobs import StepFailedError
from parfocal_ml.cell_numbers import cell_distance, latest_per_number, pair_centres
from parfocal_ml.run_result_set import RunSet, built, centres_of, importing, uniform

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
SET = uuid.UUID("00000000-0000-4000-8000-000000000003")


def square(x: float, y: float, side: float = 6.0) -> list[float]:
    return [x, y, x + side, y, x + side, y + side, x, y + side]


def run_set(status: str = "importing") -> RunSet:
    return RunSet(SET, SLIDE, status, 0.25, 4)


def test_cells_found_again_keep_their_numbers_and_new_ones_follow_in_reading_order() -> None:
    known = np.array([7, 3], dtype=np.int64)
    known_xy = np.array([[100.0, 100.0], [500.0, 40.0]])
    incoming = np.array([[900.0, 300.0], [502.0, 41.0], [10.0, 300.0], [101.0, 99.0]])
    matching = pair_centres(known, known_xy, incoming, cell_distance(0.25))
    assert matching.inherited == 2
    assert matching.numbers(8).tolist() == [9, 3, 8, 7]


def test_nothing_known_numbers_every_cell_from_the_first_new_number() -> None:
    incoming = np.array([[50.0, 20.0], [10.0, 20.0], [5.0, 5.0]])
    empty = pair_centres(np.zeros(0, np.int64), np.zeros((0, 2)), incoming, 16.0)
    assert empty.numbers(1).tolist() == [3, 2, 1]


def test_the_latest_set_wins_when_a_number_repeats() -> None:
    numbers, centres = latest_per_number(
        np.array([4, 5, 4], dtype=np.int64), np.array([[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]])
    )
    assert dict(zip(numbers.tolist(), centres[:, 0].tolist(), strict=True)) == {4: 2.0, 5: 1.0}
    assert cell_distance(None) == 16.0


def test_a_mix_of_typed_and_untyped_cells_drops_every_probability() -> None:
    typed = Cell(1, square(0, 0), 0, probs=[255, 0, 0, 0])
    untyped = Cell(1, square(20, 0))
    cells, dropped = uniform([typed, untyped])
    assert dropped
    assert all(cell.probs is None for cell in cells)
    assert uniform([typed, typed]) == ([typed, typed], False)


def test_the_built_set_holds_every_cell_with_its_number_type_and_probabilities() -> None:
    cells = [
        Cell(1, square(10, 10), 0, probs=[200, 20, 20, 15]),
        Cell(1, square(3000, 10), 2, probs=[10, 20, 200, 25]),
    ]
    assert centres_of(cells).tolist() == [[13.0, 13.0], [3003.0, 13.0]]
    files = built(TENANT, run_set(), cells, np.array([12, 40], dtype=np.int64))
    assert [entry.cell_count for entry in files.entries] == [1, 1]
    stored = [cell for chunk in files.chunks for cell in cells_in(*chunk_of(chunk.data))]
    assert [(cell.number, cell.class_index) for cell in stored] == [(12, 0), (40, 2)]
    assert [cell.probs for cell in stored] == [[200, 20, 20, 15], [10, 20, 200, 25]]
    summary = summary_of(files.summary.data, files.prefix)
    assert list(summary.numbers()) == [12, 40]


def test_a_closed_result_set_fails_the_stage_with_a_code() -> None:
    assert importing(run_set()) == run_set()
    with pytest.raises(StepFailedError):
        importing(run_set("failed"))
