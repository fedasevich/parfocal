import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from parfocal_common.embedding_cache import EMBEDDING_CONTENT_TYPE, tile_key
from parfocal_ml.embedding_service import Encoder, TileReader, Writer, pack_embedding
from parfocal_ml.gpu_pool import INTERACTIVE_SCALEDOWN_SECONDS, POOLS, Family, PoolLimits
from parfocal_ml.sam_contract import pixel_values

WARM_EVERY_SECONDS = INTERACTIVE_SCALEDOWN_SECONDS - 60
INTERACTIVE_TARGET_SECONDS = 1.0


class Kind(StrEnum):
    PROBE = "probe"
    WARM = "warm"
    EMBED = "embed"
    REGION_PASS = "region-pass"
    DETECT = "detect"
    TYPE = "type"
    EMBEDDING_CACHE = "embedding-cache"


INTERACTIVE_KINDS = frozenset({Kind.WARM, Kind.EMBED, Kind.REGION_PASS})
JOB_KINDS = frozenset({Kind.DETECT, Kind.TYPE, Kind.EMBEDDING_CACHE})


class Device(StrEnum):
    FAST = "fast"
    SLOW = "slow"


class Warm(StrEnum):
    FIRED = "fired"
    THROTTLED = "throttled"
    NOT_NEEDED = "not-needed"


class WrongLaneError(ValueError):
    pass


def interactive_pool() -> PoolLimits:
    return next(pool for pool in POOLS if pool.family is Family.EMBEDDER)


def accepts(pool: PoolLimits, kind: str) -> bool:
    if kind == Kind.PROBE:
        return True
    if pool.family is Family.EMBEDDER:
        return kind in INTERACTIVE_KINDS
    return kind in JOB_KINDS


def check_lane(pool: PoolLimits, kind: str) -> None:
    if not accepts(pool, kind):
        lane = "interactive" if pool.family is Family.EMBEDDER else "job"
        raise WrongLaneError(f"{kind!r} does not run in the {lane} pool {pool.family}")


class Pools(Protocol):
    def spawn(self, function_name: str, call: dict[str, object]) -> None: ...

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]: ...


@dataclass
class InteractiveGate:
    pools: Pools
    clock: Callable[[], float] = time.monotonic
    warm_every: float = WARM_EVERY_SECONDS

    def __post_init__(self) -> None:
        self.pool = interactive_pool()
        self.lock = threading.Lock()
        self.last_touch: float | None = None

    def touched_recently(self, now: float) -> bool:
        return self.last_touch is not None and now - self.last_touch < self.warm_every

    def activate(self, device: Device) -> Warm:
        if device is not Device.SLOW:
            return Warm.NOT_NEEDED
        with self.lock:
            now = self.clock()
            if self.touched_recently(now):
                return Warm.THROTTLED
            self.last_touch = now
        self.pools.spawn(self.pool.function_name, {"kind": Kind.WARM.value})
        return Warm.FIRED

    def request(self, call: dict[str, object]) -> dict[str, object]:
        check_lane(self.pool, str(call.get("kind")))
        if call.get("kind") == Kind.WARM:
            raise WrongLaneError("warm goes through activate, which throttles it")
        reply = self.pools.call(self.pool.function_name, call)
        with self.lock:
            self.last_touch = self.clock()
        return reply


@dataclass(frozen=True)
class EmbedTile:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    column: int
    row: int
    x: int
    y: int
    tile: int


def embed_tile(
    request: EmbedTile, read: TileReader, encode: Encoder, write: Writer
) -> dict[str, object]:
    rgb = read(request.x, request.y, request.tile, request.tile)
    body = pack_embedding(encode(pixel_values(rgb)))
    key = tile_key(request.tenant_id, request.slide_id, request.column, request.row)
    write(key, body, EMBEDDING_CONTENT_TYPE)
    return {"key": key, "column": request.column, "row": request.row, "bytes": len(body)}


class ModalPools:
    def __init__(self, app_name: str, environment: str | None = None) -> None:
        self.app_name = app_name
        self.environment = environment

    def function(self, function_name: str):
        import modal

        return modal.Function.from_name(
            self.app_name, function_name, environment_name=self.environment
        )

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.function(function_name).spawn(call)

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return self.function(function_name).remote(call)
