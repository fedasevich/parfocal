import multiprocessing
import uuid

import numpy as np
import pytest
from numpy.typing import NDArray

from parfocal_common.embedding_cache import EMBEDDING_BYTES, EMBEDDING_DIMS, tile_key
from parfocal_ml.gate_load import ContainerSpec, LocalPools, first_call, number
from parfocal_ml.gpu_pool import POOLS, Family, validate_pools
from parfocal_ml.modal_pool import pool_entry
from parfocal_ml.priority_gate import (
    INTERACTIVE_KINDS,
    JOB_KINDS,
    WARM_EVERY_SECONDS,
    Device,
    EmbedTile,
    InteractiveGate,
    Kind,
    Warm,
    WrongLaneError,
    accepts,
    embed_tile,
    interactive_pool,
)


class RecordingPools:
    def __init__(self) -> None:
        self.spawned: list[tuple[str, dict[str, object]]] = []
        self.called: list[tuple[str, dict[str, object]]] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.spawned.append((function_name, call))

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        self.called.append((function_name, call))
        return {"ok": True}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def pool_for(family: Family):
    return next(pool for pool in POOLS if pool.family is family)


def test_interactive_kinds_run_only_in_the_embedder_and_job_kinds_never_do() -> None:
    embedder = interactive_pool()
    assert embedder.family is Family.EMBEDDER
    for kind in INTERACTIVE_KINDS:
        assert accepts(embedder, kind)
    for kind in JOB_KINDS:
        assert not accepts(embedder, kind)
    for pool in POOLS:
        if pool.family is not Family.EMBEDDER:
            assert not any(accepts(pool, kind) for kind in INTERACTIVE_KINDS)
            assert all(accepts(pool, kind) for kind in JOB_KINDS)


def test_the_modal_entry_refuses_a_whole_slide_job_in_the_embedder_pool() -> None:
    with pytest.raises(WrongLaneError, match="interactive pool"):
        pool_entry(interactive_pool())({"kind": "embedding-cache"})
    with pytest.raises(WrongLaneError, match="job pool"):
        pool_entry(pool_for(Family.DETECTOR_GOOD))({"kind": "embed"})


def test_a_warm_call_starts_the_embedder_and_reports_it() -> None:
    reply = pool_entry(interactive_pool())({"kind": "warm"})
    assert reply["family"] == "embedder"
    assert reply["warm"] is True


def test_the_gate_adds_no_pool_and_keeps_every_pool_at_zero() -> None:
    validate_pools(POOLS)
    assert all(pool.min_containers == 0 and pool.buffer_containers == 0 for pool in POOLS)


def test_only_a_slow_device_warms_the_embedder() -> None:
    pools = RecordingPools()
    gate = InteractiveGate(pools, clock=Clock())
    assert gate.activate(Device.FAST) is Warm.NOT_NEEDED
    assert pools.spawned == []
    assert gate.activate(Device.SLOW) is Warm.FIRED
    assert pools.spawned == [("embedder", {"kind": "warm"})]


def test_repeated_activations_inside_the_window_send_one_warm_call() -> None:
    pools = RecordingPools()
    clock = Clock()
    gate = InteractiveGate(pools, clock=clock)
    assert gate.activate(Device.SLOW) is Warm.FIRED
    for _ in range(50):
        clock.now += 1
        assert gate.activate(Device.SLOW) is Warm.THROTTLED
    clock.now += WARM_EVERY_SECONDS
    assert gate.activate(Device.SLOW) is Warm.FIRED
    assert len(pools.spawned) == 2
    assert interactive_pool().scaledown_window_seconds > WARM_EVERY_SECONDS


def test_a_request_keeps_the_container_warm_so_no_extra_warm_is_sent() -> None:
    pools = RecordingPools()
    clock = Clock()
    gate = InteractiveGate(pools, clock=clock)
    clock.now += WARM_EVERY_SECONDS + 1
    gate.request({"kind": "embed", "column": 0, "row": 0})
    assert gate.activate(Device.SLOW) is Warm.THROTTLED
    assert pools.called == [("embedder", {"kind": "embed", "column": 0, "row": 0})]


def test_the_gate_refuses_job_kinds_and_bare_warm_calls() -> None:
    gate = InteractiveGate(RecordingPools(), clock=Clock())
    with pytest.raises(WrongLaneError):
        gate.request({"kind": Kind.DETECT.value})
    with pytest.raises(WrongLaneError, match="activate"):
        gate.request({"kind": Kind.WARM.value})


def test_an_interactive_embed_writes_the_tile_and_replies_with_its_key_only() -> None:
    written: dict[str, bytes] = {}
    tenant, slide = uuid.UUID(int=1), uuid.UUID(int=2)

    def encode(pixels: NDArray[np.float32]) -> NDArray[np.float32]:
        assert pixels.shape == (1, 3, 1024, 1024)
        return np.zeros(EMBEDDING_DIMS, dtype=np.float32)

    def write(key: str, body: bytes, _content_type: str) -> None:
        written[key] = body

    reply = embed_tile(
        EmbedTile(tenant, slide, 3, 4, 1536, 2048, 512),
        lambda x, y, width, height: np.zeros((height, width, 3), dtype=np.uint8),
        encode,
        write,
    )
    assert reply == {
        "key": tile_key(tenant, slide, 3, 4),
        "column": 3,
        "row": 4,
        "bytes": EMBEDDING_BYTES,
    }
    assert len(written[str(reply["key"])]) == EMBEDDING_BYTES
    assert len(repr(reply)) < 200


def test_local_pools_serve_a_pre_warmed_embed_through_the_gate() -> None:
    reply = first_call(multiprocessing.get_context("spawn"), 1, warm=True, rounds=1)
    assert reply["pre_warmed"] is True
    assert number(reply["max"]) < 5.0


def test_local_pools_start_a_container_on_first_use_and_stop_it() -> None:
    pools = LocalPools(
        multiprocessing.get_context("spawn"), {"embedder": ContainerSpec("embedder", 4, 1)}
    )
    try:
        gate = InteractiveGate(pools)
        reply = gate.request({"kind": "embed", "column": 1, "row": 0})
        assert reply["bytes"] == EMBEDDING_BYTES
        process = pools.containers["embedder"].process
    finally:
        pools.stop()
    assert not process.is_alive()


def test_the_api_warm_gate_names_the_deployed_embedder() -> None:
    from parfocal_common.warm_gate import EMBEDDER_FUNCTION, GPU_POOL_APP, WARM_KIND
    from parfocal_ml.gpu_pool import INTERACTIVE_SCALEDOWN_SECONDS
    from parfocal_ml.modal_pool import APP_NAME

    assert GPU_POOL_APP == APP_NAME
    assert interactive_pool().function_name == EMBEDDER_FUNCTION
    assert Kind.WARM.value == WARM_KIND
    assert WARM_EVERY_SECONDS == INTERACTIVE_SCALEDOWN_SECONDS - 60
