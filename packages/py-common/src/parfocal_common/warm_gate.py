import importlib
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol, cast

GPU_POOL_APP = "parfocal-gpu-pool"
EMBEDDER_FUNCTION = "embedder"
WARM_KIND = "warm"
WARM_EVERY_SECONDS = 240.0


class Device(StrEnum):
    FAST = "fast"
    SLOW = "slow"


class Warm(StrEnum):
    FIRED = "fired"
    THROTTLED = "throttled"
    NOT_NEEDED = "not-needed"


class Pools(Protocol):
    def spawn(self, function_name: str, call: dict[str, object]) -> None: ...

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]: ...


class PendingPools(Protocol):
    def submit(self, function_name: str, call: dict[str, object]) -> str: ...

    def outcome(self, call_id: str, hold: float | None) -> dict[str, object] | None: ...

    def cancel(self, call_id: str) -> None: ...


class UnknownCallError(LookupError):
    pass


@dataclass
class HeldCalls:
    pools: Pools
    answers: dict[str, dict[str, object]] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def submit(self, function_name: str, call: dict[str, object]) -> str:
        call_id = f"held-{uuid.uuid4().hex}"
        answer = self.pools.call(function_name, call)
        with self.lock:
            self.answers[call_id] = answer
        return call_id

    def outcome(self, call_id: str, hold: float | None) -> dict[str, object] | None:
        with self.lock:
            answer = self.answers.pop(call_id, None)
        if answer is None:
            raise UnknownCallError(call_id)
        return answer

    def cancel(self, call_id: str) -> None:
        with self.lock:
            self.answers.pop(call_id, None)


def pending_of(pools: Pools) -> PendingPools:
    if all(callable(getattr(pools, name, None)) for name in ("submit", "outcome", "cancel")):
        return cast("PendingPools", pools)
    return HeldCalls(pools)


@dataclass
class WarmGate:
    pools: Pools
    clock: Callable[[], float] = time.monotonic
    warm_every: float = WARM_EVERY_SECONDS
    function_name: str = EMBEDDER_FUNCTION
    lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    last_touch: float | None = field(default=None, init=False)
    pending: PendingPools = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.pending = pending_of(self.pools)

    def touched_recently(self, now: float) -> bool:
        return self.last_touch is not None and now - self.last_touch < self.warm_every

    def touch(self) -> None:
        with self.lock:
            self.last_touch = self.clock()

    def activate(self, device: Device) -> Warm:
        if device is not Device.SLOW:
            return Warm.NOT_NEEDED
        with self.lock:
            now = self.clock()
            if self.touched_recently(now):
                return Warm.THROTTLED
            self.last_touch = now
        self.pools.spawn(self.function_name, {"kind": WARM_KIND})
        return Warm.FIRED

    def request(self, call: dict[str, object]) -> dict[str, object]:
        reply = self.pools.call(self.function_name, call)
        self.touch()
        return reply

    def submit(self, call: dict[str, object]) -> str:
        return self.pending.submit(self.function_name, call)

    def outcome(self, call_id: str, hold: float | None) -> dict[str, object] | None:
        reply = self.pending.outcome(call_id, hold)
        if reply is not None:
            self.touch()
        return reply

    def cancel(self, call_id: str) -> None:
        self.pending.cancel(call_id)


class ModalPools:
    def __init__(self, app_name: str = GPU_POOL_APP, environment: str | None = None) -> None:
        self.app_name = app_name
        self.environment = environment

    def function(self, function_name: str) -> Any:
        modal: Any = importlib.import_module("modal")
        return modal.Function.from_name(
            self.app_name, function_name, environment_name=self.environment
        )

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.function(function_name).spawn(call)

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return self.function(function_name).remote(call)

    def submit(self, function_name: str, call: dict[str, object]) -> str:
        return str(self.function(function_name).spawn(call).object_id)

    def handle(self, call_id: str) -> Any:
        modal: Any = importlib.import_module("modal")
        return modal.FunctionCall.from_id(call_id)

    def outcome(self, call_id: str, hold: float | None) -> dict[str, object] | None:
        failures: Any = importlib.import_module("modal.exception")
        still_running = (TimeoutError, failures.TimeoutError)
        try:
            return self.handle(call_id).get(timeout=hold)
        except still_running as error:
            if type(error) in still_running:
                return None
            raise

    def cancel(self, call_id: str) -> None:
        self.handle(call_id).cancel()
