from collections.abc import Generator

import pytest
from db_support import ApiAs
from fastapi import FastAPI, Request
from test_model_runs import Lab, make_lab

from parfocal_api.gpu_warm import NoGpuPools, warm_gate_of
from parfocal_common.warm_gate import EMBEDDER_FUNCTION, WARM_EVERY_SECONDS, WarmGate


class FakeModal:
    def __init__(self, fails: bool = False) -> None:
        self.spawned: list[tuple[str, dict[str, object]]] = []
        self.fails = fails

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.spawned.append((function_name, call))
        if self.fails:
            raise ConnectionError("the GPU pool app is not deployed")

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        raise AssertionError("a warm never waits for a reply")


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


@pytest.fixture
def modal(api: ApiAs) -> Generator[FakeModal]:
    fake = FakeModal()
    api.app.state.warm_gate = WarmGate(fake, clock=Clock())
    try:
        yield fake
    finally:
        del api.app.state.warm_gate


def warm(api: ApiAs, lab: Lab, device: str, who: str = "owner", slide: int = 0) -> int:
    path = f"/api/slides/{lab.slides[slide]}/embeddings/warm"
    return api(lab.people[who]).post(path, json={"device": device}).status_code


@pytest.mark.db
def test_a_slow_device_sends_one_warm_call_and_a_fast_device_sends_none(
    api: ApiAs, lab: Lab, modal: FakeModal
) -> None:
    assert warm(api, lab, "fast") == 204
    assert modal.spawned == []
    assert warm(api, lab, "slow") == 204
    assert modal.spawned == [(EMBEDDER_FUNCTION, {"kind": "warm"})]
    for slide in (0, 1, 2):
        assert warm(api, lab, "slow", slide=slide) == 204
    assert len(modal.spawned) == 1


@pytest.mark.db
def test_the_warm_needs_a_readable_slide_and_more_than_view_rights(
    api: ApiAs, database: str, lab: Lab, modal: FakeModal
) -> None:
    other = make_lab(api, database)
    path = f"/api/slides/{other.slides[0]}/embeddings/warm"
    refused = api(lab.people["owner"]).post(path, json={"device": "slow"})
    assert refused.status_code == 404, refused.text
    assert warm(api, lab, "slow", who="outsider") in {403, 404}
    assert warm(api, lab, "unknown") == 422
    assert modal.spawned == []


@pytest.mark.db
def test_a_failing_modal_call_still_answers_and_waits_out_the_window(api: ApiAs, lab: Lab) -> None:
    clock = Clock()
    fake = FakeModal(fails=True)
    api.app.state.warm_gate = WarmGate(fake, clock=clock)
    try:
        assert warm(api, lab, "slow") == 204
        assert warm(api, lab, "slow") == 204
        assert len(fake.spawned) == 1
        clock.now += WARM_EVERY_SECONDS
        assert warm(api, lab, "slow") == 204
        assert len(fake.spawned) == 2
    finally:
        del api.app.state.warm_gate


def test_an_app_without_a_modal_client_keeps_one_idle_gate() -> None:
    app = FastAPI()
    first = warm_gate_of(Request({"type": "http", "app": app}))
    assert isinstance(first.pools, NoGpuPools)
    assert warm_gate_of(Request({"type": "http", "app": app})) is first
