import uuid

import numpy as np
import pytest
from test_tumor_map import ArraySlide
from tumor_map_support import CentreScorer
from view_map_support import HEIGHT, WIDTH, StandInPools, view_slide

from parfocal_common.view_maps import (
    TILE_CELLS,
    ViewTile,
    ViewTileCallError,
    cells_in,
    view_tile_of,
)
from parfocal_common.warm_gate import EMBEDDER_FUNCTION
from parfocal_ml.priority_gate import InteractiveGate, Kind, accepts, interactive_pool
from parfocal_ml.tumor_map import halve, map_slide, stored_values
from parfocal_ml.view_map import JOB_CELLS, view_tile_values

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")


def whole_map_halved_twice() -> np.ndarray:
    slide = view_slide()
    tumor_map = map_slide(slide.reader, CentreScorer(), slide.tissue())
    return halve(halve(stored_values(tumor_map.probability, tumor_map.tissue)))


def test_a_view_tile_is_the_job_grid_boxed_and_halved_twice() -> None:
    assert JOB_CELLS == 64
    whole = whole_map_halved_twice()
    first = view_tile_values(view_slide(), CentreScorer(), 0, 0)
    below = view_tile_values(view_slide(), CentreScorer(), 0, 1)
    assert first.shape == (TILE_CELLS, TILE_CELLS)
    assert below.shape == (2, TILE_CELLS)
    np.testing.assert_array_equal(first, whole[:TILE_CELLS])
    np.testing.assert_array_equal(below, whole[TILE_CELLS:])
    assert first.max() > 0
    assert first[0].max() == 0


def test_a_view_tile_scores_only_the_job_tiles_in_its_box() -> None:
    slide = view_slide()
    view_tile_values(slide, CentreScorer(), 0, 1)
    assert isinstance(slide.reader, ArraySlide)
    assert len(slide.reader.reads) == 2


def test_the_interactive_lane_answers_a_view_tile_with_its_cell_bytes() -> None:
    assert accepts(interactive_pool(), Kind.VIEW_MAP)
    pools = StandInPools()
    gate = InteractiveGate(pools)
    reply = gate.request(ViewTile(TENANT, SLIDE, 0, 0).call())
    cells = cells_in(reply, TILE_CELLS, TILE_CELLS)
    assert cells is not None
    assert len(cells) == 256
    assert pools.calls[0][0] == EMBEDDER_FUNCTION
    assert gate.last_touch is not None
    np.testing.assert_array_equal(
        np.frombuffer(cells, np.uint8).reshape(TILE_CELLS, TILE_CELLS),
        whole_map_halved_twice()[:TILE_CELLS],
    )


def test_a_view_tile_outside_the_slide_or_a_broken_call_is_refused() -> None:
    gate = InteractiveGate(StandInPools())
    with pytest.raises(ValueError, match="outside the slide"):
        gate.request(ViewTile(TENANT, SLIDE, 1, 0).call())
    with pytest.raises(ViewTileCallError):
        view_tile_of({"kind": "view-map", "column": "0", "row": 0})
    assert (WIDTH, HEIGHT) == (4096, 4608)
