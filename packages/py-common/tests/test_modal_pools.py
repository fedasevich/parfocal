from typing import Any

import pytest

from parfocal_common.warm_gate import ModalPools

modal_exception = pytest.importorskip("modal.exception")


class Handle:
    def __init__(self, failure: BaseException | None) -> None:
        self.failure = failure

    def get(self, timeout: float | None = None) -> dict[str, object]:
        if self.failure is not None:
            raise self.failure
        return {"cells": []}


def pools_raising(failure: BaseException | None, monkeypatch: pytest.MonkeyPatch) -> ModalPools:
    def handle(call_id: str) -> Handle:
        return Handle(failure)

    pools = ModalPools()
    monkeypatch.setattr(pools, "handle", handle)
    return pools


@pytest.mark.parametrize(
    "still_running",
    [TimeoutError(), modal_exception.TimeoutError()],
    ids=["the timeout modal raises from a held get", "the timeout modal names its own"],
)
def test_a_call_still_running_after_the_hold_is_waiting(
    still_running: BaseException, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert pools_raising(still_running, monkeypatch).outcome("fc-1", 45.0) is None


def test_a_call_that_answered_returns_its_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    assert pools_raising(None, monkeypatch).outcome("fc-1", 45.0) == {"cells": []}


def test_a_gpu_function_that_ran_out_of_time_is_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    failure: Any = modal_exception.FunctionTimeoutError("the worker ran past its timeout")
    with pytest.raises(modal_exception.FunctionTimeoutError):
        pools_raising(failure, monkeypatch).outcome("fc-1", 45.0)
