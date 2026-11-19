from collections.abc import Generator

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, problem
from test_outline_types import SQUARE, FakeTyper
from view_map_support import HEIGHT, WIDTH, StandInPools
from workspace_support import owner

from parfocal_api.gpu_calls import HOLD_SECONDS, GpuCalls, gpu_calls_of
from parfocal_api.token_keys import usable_keys
from parfocal_common.warm_gate import Pools, UnknownCallError, WarmGate

pytestmark = pytest.mark.db

CLOUDFLARE_CUTS_AT = 100.0
EU_WAIT = 150.0


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


class EuQueue:
    def __init__(self, clock: Clock, answers: Pools, ready_after: float = EU_WAIT) -> None:
        self.clock = clock
        self.answers = answers
        self.ready_at = clock.now + ready_after
        self.submitted: dict[str, tuple[str, dict[str, object]]] = {}
        self.holds: list[float | None] = []
        self.cancelled: list[str] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        return None

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        raise AssertionError("a GPU call never holds the request until the pool answers")

    def submit(self, function_name: str, call: dict[str, object]) -> str:
        call_id = f"fc-{len(self.submitted) + 1}"
        self.submitted[call_id] = (function_name, call)
        return call_id

    def outcome(self, call_id: str, hold: float | None) -> dict[str, object] | None:
        if call_id in self.cancelled or call_id not in self.submitted:
            raise UnknownCallError(call_id)
        self.holds.append(hold)
        assert hold is not None
        self.clock.now = min(self.clock.now + hold, max(self.ready_at, self.clock.now))
        if self.clock.now < self.ready_at:
            return None
        return self.answers.call(*self.submitted[call_id])

    def cancel(self, call_id: str) -> None:
        self.cancelled.append(call_id)


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    made = make_lab(api, database)
    owner(
        database,
        f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{made.slides[0]}'",
    )
    return made


@pytest.fixture
def clock() -> Clock:
    return Clock()


def queue_in(api: ApiAs, queue: EuQueue, clock: Clock) -> None:
    keys = usable_keys(api.app.settings.tile_token_key)

    def calls() -> GpuCalls:
        return GpuCalls(WarmGate(queue), keys, clock)

    api.app.dependency_overrides[gpu_calls_of] = calls


@pytest.fixture
def view_queue(api: ApiAs, clock: Clock) -> Generator[EuQueue]:
    queue = EuQueue(clock, StandInPools())
    queue_in(api, queue, clock)
    try:
        yield queue
    finally:
        api.app.dependency_overrides.pop(gpu_calls_of, None)


@pytest.fixture
def typer_queue(api: ApiAs, clock: Clock) -> Generator[EuQueue]:
    queue = EuQueue(clock, FakeTyper())
    queue_in(api, queue, clock)
    try:
        yield queue
    finally:
        api.app.dependency_overrides.pop(gpu_calls_of, None)


def view_path(lab: Lab, slide: int = 0) -> str:
    return f"/api/slides/{lab.slides[slide]}/view-map/0/0"


def typer_path(lab: Lab) -> str:
    return f"/api/slides/{lab.slides[0]}/outline-types"


TYPER_BODY = {"outlines": [{"points": SQUARE}]}


def test_a_view_map_call_held_150_s_by_the_pool_ends_in_cells_without_a_524(
    api: ApiAs, database: str, lab: Lab, view_queue: EuQueue
) -> None:
    person = api(lab.people["reader"])
    response = person.post(view_path(lab))
    waits: list[float] = []
    while response.status_code == 202:
        waiting = response.json()
        assert waiting["state"] == "waiting"
        assert response.headers["cache-control"] == "no-store"
        waits.append(waiting["waited_seconds"])
        response = person.post(view_path(lab), params={"call": waiting["call"]})
    assert response.status_code == 200, response.text
    assert len(response.content) == 256
    assert waits == [45.0, 90.0, 135.0]
    assert all(hold is not None and hold < CLOUDFLARE_CUTS_AT for hold in view_queue.holds)
    assert max(hold or 0 for hold in view_queue.holds) == HOLD_SECONDS
    assert len(view_queue.submitted) == 1
    rows = owner(
        database,
        "SELECT (details::jsonb->>'waited_seconds')::float FROM audit_events "
        f"WHERE action = 'view-map.scored' AND target_id = '{lab.slides[0]}'",
    )
    assert rows == [(EU_WAIT,)]


def test_a_quick_pool_answers_in_the_first_request(api: ApiAs, lab: Lab, clock: Clock) -> None:
    queue = EuQueue(clock, StandInPools(), ready_after=3.0)
    queue_in(api, queue, clock)
    try:
        response = api(lab.people["owner"]).post(view_path(lab))
    finally:
        api.app.dependency_overrides.pop(gpu_calls_of, None)
    assert response.status_code == 200, response.text
    assert len(queue.holds) == 1


def test_the_typer_waits_then_answers_with_its_types(
    api: ApiAs, lab: Lab, typer_queue: EuQueue
) -> None:
    person = api(lab.people["owner"])
    first = person.post(typer_path(lab), json=TYPER_BODY)
    assert first.status_code == 202, first.text
    response = first
    while response.status_code == 202:
        response = person.post(
            typer_path(lab), json=TYPER_BODY, params={"call": response.json()["call"]}
        )
    assert response.status_code == 200, response.text
    assert response.json()["outlines"][0]["type"] == "tumor"


def test_cancel_stops_the_call_and_it_cannot_be_polled_again(
    api: ApiAs, lab: Lab, typer_queue: EuQueue
) -> None:
    person = api(lab.people["owner"])
    token = person.post(typer_path(lab), json=TYPER_BODY).json()["call"]
    cancelled = person.delete(f"/api/gpu-calls/{token}")
    assert cancelled.status_code == 204, cancelled.text
    assert typer_queue.cancelled == ["fc-1"]
    again = person.post(typer_path(lab), json=TYPER_BODY, params={"call": token})
    assert problem(again) == (404, "gpu-call-not-found")


def test_someone_else_cannot_poll_or_cancel_a_wait(
    api: ApiAs, lab: Lab, view_queue: EuQueue
) -> None:
    token = api(lab.people["owner"]).post(view_path(lab)).json()["call"]
    other = api(lab.people["reader"])
    assert problem(other.post(view_path(lab), params={"call": token})) == (
        404,
        "gpu-call-not-found",
    )
    assert other.delete(f"/api/gpu-calls/{token}").status_code == 204
    assert view_queue.cancelled == []


def test_a_wait_cannot_be_moved_to_another_kind_of_call(
    api: ApiAs, lab: Lab, view_queue: EuQueue
) -> None:
    person = api(lab.people["owner"])
    token = person.post(view_path(lab)).json()["call"]
    moved = person.post(typer_path(lab), json=TYPER_BODY, params={"call": token})
    assert problem(moved) == (404, "gpu-call-not-found")


def test_a_forged_wait_is_refused(api: ApiAs, lab: Lab, view_queue: EuQueue) -> None:
    forged = api(lab.people["owner"]).post(view_path(lab), params={"call": "e30.c2lnbmF0dXJl"})
    assert problem(forged) == (404, "gpu-call-not-found")
    assert view_queue.submitted == {}
