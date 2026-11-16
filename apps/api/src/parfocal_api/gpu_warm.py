import logging
from typing import cast

from fastapi import Request
from starlette.concurrency import run_in_threadpool

from parfocal_common.warm_gate import Device, Pools, Warm, WarmGate

logger = logging.getLogger("parfocal.api.gpu_warm")


class NoGpuPools:
    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        return None

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return {}


def gpu_pools_of(request: Request) -> Pools:
    pools = getattr(request.app.state, "gpu_pools", None)
    return NoGpuPools() if pools is None else cast("Pools", pools)


def warm_gate_of(request: Request) -> WarmGate:
    state = request.app.state
    gate = getattr(state, "warm_gate", None)
    if not isinstance(gate, WarmGate):
        gate = WarmGate(NoGpuPools())
        state.warm_gate = gate
    return gate


async def warm_for(gate: WarmGate, device: Device) -> Warm | None:
    try:
        return await run_in_threadpool(gate.activate, device)
    except Exception as error:
        logger.warning("embedder warm call failed: %s", type(error).__name__)
        return None
