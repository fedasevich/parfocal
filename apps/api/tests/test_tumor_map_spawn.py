from collections.abc import Generator

import pytest
from db_support import ApiAs
from test_gpu_warm import FakeModal
from test_model_runs import Lab, make_lab
from test_tumor_maps import start, work

from parfocal_common.tumor_maps import POOL_FUNCTION

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


def pools_on(api: ApiAs, fake: FakeModal) -> Generator[FakeModal]:
    api.app.state.gpu_pools = fake
    try:
        yield fake
    finally:
        del api.app.state.gpu_pools


@pytest.fixture
def modal(api: ApiAs) -> Generator[FakeModal]:
    yield from pools_on(api, FakeModal())


@pytest.fixture
def broken_modal(api: ApiAs) -> Generator[FakeModal]:
    yield from pools_on(api, FakeModal(fails=True))


def test_a_queued_tumor_map_wakes_the_detector_good_pool_once(
    api: ApiAs, lab: Lab, modal: FakeModal
) -> None:
    assert start(api, lab).status_code == 201
    assert modal.spawned == [(POOL_FUNCTION, {"kind": "tumor-map"})]


def test_a_refused_tumor_map_wakes_no_pool(api: ApiAs, lab: Lab, modal: FakeModal) -> None:
    for who in ("viewer", "reader", "outsider"):
        assert start(api, lab, who).status_code in {403, 404}
    assert modal.spawned == []


def test_a_failed_spawn_still_queues_the_map(
    api: ApiAs, database: str, lab: Lab, broken_modal: FakeModal
) -> None:
    response = start(api, lab)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "queued"
    assert len(broken_modal.spawned) == 1
    assert work(database, lab.tenant)
