import uuid
from dataclasses import dataclass
from enum import StrEnum

from parfocal_common.embedding_cache import EMBEDDING_CONTENT_TYPE, tile_key
from parfocal_common.warm_gate import WARM_EVERY_SECONDS, Device, ModalPools, Pools, Warm, WarmGate
from parfocal_ml.embedding_service import Encoder, TileReader, Writer, pack_embedding
from parfocal_ml.gpu_pool import POOLS, Family, PoolLimits
from parfocal_ml.sam_contract import pixel_values

INTERACTIVE_TARGET_SECONDS = 1.0
__all__ = ["WARM_EVERY_SECONDS", "Device", "ModalPools", "Pools", "Warm"]


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


@dataclass
class InteractiveGate(WarmGate):
    def __post_init__(self) -> None:
        self.pool = interactive_pool()
        self.function_name = self.pool.function_name

    def request(self, call: dict[str, object]) -> dict[str, object]:
        check_lane(self.pool, str(call.get("kind")))
        if call.get("kind") == Kind.WARM:
            raise WrongLaneError("warm goes through activate, which throttles it")
        reply = self.pools.call(self.pool.function_name, call)
        self.touch()
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
