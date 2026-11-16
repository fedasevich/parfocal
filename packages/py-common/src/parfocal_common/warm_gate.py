import importlib
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

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


@dataclass
class WarmGate:
    pools: Pools
    clock: Callable[[], float] = time.monotonic
    warm_every: float = WARM_EVERY_SECONDS
    function_name: str = EMBEDDER_FUNCTION
    lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    last_touch: float | None = field(default=None, init=False)

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
