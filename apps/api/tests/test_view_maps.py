import uuid
from collections.abc import Generator

import numpy as np
import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, problem
from tumor_map_support import CentreScorer
from view_map_support import HEIGHT, WIDTH, StandInPools, view_slide
from workspace_support import owner

from parfocal_common.warm_gate import EMBEDDER_FUNCTION, WarmGate
from parfocal_ml.view_map import view_tile_values

pytestmark = pytest.mark.db


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    made = make_lab(api, database)
    owner(
        database,
        f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{made.slides[0]}'",
    )
    return made


@pytest.fixture
def pools(api: ApiAs) -> Generator[StandInPools]:
    stand_in = StandInPools()
    api.app.state.warm_gate = WarmGate(stand_in)
    try:
        yield stand_in
    finally:
        del api.app.state.warm_gate


def tile_path(slide: uuid.UUID, column: int, row: int) -> str:
    return f"/api/slides/{slide}/view-map/{column}/{row}"


def ask(api: ApiAs, lab: Lab, column: int = 0, row: int = 0, who: str = "owner", slide: int = 0):
    return api(lab.people[who]).post(tile_path(lab.slides[slide], column, row))


def test_one_view_tile_comes_back_as_its_256_cell_bytes(
    api: ApiAs, lab: Lab, pools: StandInPools
) -> None:
    response = ask(api, lab)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    assert len(response.content) == 256
    expected = view_tile_values(view_slide(), CentreScorer(), 0, 0)
    np.testing.assert_array_equal(np.frombuffer(response.content, np.uint8), expected.ravel())
    assert max(response.content) > 0
    name, call = pools.calls[0]
    assert name == EMBEDDER_FUNCTION
    assert call == {
        "kind": "view-map",
        "tenant_id": str(lab.tenant),
        "slide_id": str(lab.slides[0]),
        "column": 0,
        "row": 0,
    }
    edge = ask(api, lab, row=1)
    assert edge.status_code == 200, edge.text
    assert len(edge.content) == 2 * 16


def test_a_tile_outside_the_slide_or_a_slide_without_size_is_refused(
    api: ApiAs, lab: Lab, pools: StandInPools
) -> None:
    assert problem(ask(api, lab, column=1)) == (404, "view-tile-outside")
    assert problem(ask(api, lab, row=2)) == (404, "view-tile-outside")
    assert problem(ask(api, lab, slide=1)) == (404, "view-tile-outside")
    assert ask(api, lab, column=-1).status_code == 422
    assert pools.calls == []


def test_only_a_member_who_runs_models_may_ask(
    api: ApiAs, database: str, lab: Lab, pools: StandInPools
) -> None:
    assert ask(api, lab, who="reader").status_code == 403
    assert ask(api, lab, who="viewer").status_code == 403
    assert ask(api, lab, who="outsider").status_code == 404
    other = make_lab(api, database)
    refused = api(lab.people["owner"]).post(tile_path(other.slides[0], 0, 0))
    assert refused.status_code == 404, refused.text
    assert pools.calls == []


def test_no_answering_worker_is_an_offline_problem(api: ApiAs, lab: Lab) -> None:
    assert problem(ask(api, lab)) == (409, "model-offline")
