import uuid
from collections.abc import Generator

import numpy as np
import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, problem
from tumor_map_support import CentreScorer
from view_map_support import HEIGHT, WIDTH, StandInPools, view_slide
from workspace_support import owner

from parfocal_api.principals import ServicePrincipal
from parfocal_common.view_maps import timed
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


def test_anyone_who_can_read_the_slide_may_ask(
    api: ApiAs, database: str, lab: Lab, pools: StandInPools
) -> None:
    assert ask(api, lab, who="reader").status_code == 200
    assert ask(api, lab, who="viewer").status_code == 200
    assert len(pools.calls) == 2
    assert ask(api, lab, who="stranger").status_code == 404
    assert ask(api, lab, who="outsider").status_code == 404
    other = make_lab(api, database)
    refused = api(lab.people["owner"]).post(tile_path(other.slides[0], 0, 0))
    assert refused.status_code == 404, refused.text
    assert len(pools.calls) == 2


def test_a_person_without_read_access_is_forbidden(
    api: ApiAs, lab: Lab, pools: StandInPools
) -> None:
    no_scopes: frozenset[str] = frozenset()
    for scopes in (no_scopes, frozenset({"see-people"})):
        service = ServicePrincipal(uuid.uuid4(), lab.tenant, scopes)
        refused = api(service).post(tile_path(lab.slides[0], 0, 0))
        assert refused.status_code == 403, refused.text
    assert pools.calls == []


def test_a_reviewer_whose_ai_is_hidden_cannot_map_the_view(
    api: ApiAs, database: str, pools: StandInPools
) -> None:
    hidden = make_lab(api, database, hidden=True)
    owner(
        database,
        f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{hidden.slides[0]}'",
    )
    assert ask(api, hidden, who="reader").status_code == 404
    assert pools.calls == []


class TimedPools(StandInPools):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return timed(super().call(function_name, call), 1.25)


def test_the_gpu_seconds_land_on_the_person_who_asked(api: ApiAs, database: str, lab: Lab) -> None:
    api.app.state.warm_gate = WarmGate(TimedPools())
    try:
        assert ask(api, lab, who="reader").status_code == 200
        assert ask(api, lab, who="reader", row=1).status_code == 200
        assert ask(api, lab, who="owner").status_code == 200
    finally:
        del api.app.state.warm_gate
    rows = owner(
        database,
        "SELECT p.subject, sum((e.details::jsonb->>'gpu_seconds')::float), count(*) "
        "FROM audit_events e JOIN audit_people p ON p.id = e.actor_id "
        f"WHERE e.action = 'view-map.scored' AND e.target_id = '{lab.slides[0]}' "
        "GROUP BY p.subject",
    )
    assert {subject: (seconds, count) for subject, seconds, count in rows} == {
        lab.people["reader"].subject: (2.5, 2),
        lab.people["owner"].subject: (1.25, 1),
    }


def test_the_wait_is_counted_when_the_worker_reports_no_seconds(
    api: ApiAs, database: str, lab: Lab, pools: StandInPools
) -> None:
    assert ask(api, lab, who="reader").status_code == 200
    rows = owner(
        database,
        "SELECT (details::jsonb->>'gpu_seconds')::float FROM audit_events "
        f"WHERE action = 'view-map.scored' AND target_id = '{lab.slides[0]}'",
    )
    assert len(rows) == 1
    seconds = rows[0][0]
    assert isinstance(seconds, float)
    assert seconds > 0


def test_no_answering_worker_is_an_offline_problem(api: ApiAs, lab: Lab) -> None:
    assert problem(ask(api, lab)) == (409, "model-offline")
