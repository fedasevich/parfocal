from dataclasses import dataclass
from enum import StrEnum
from typing import TypedDict

MIB_PER_GIB = 1024
INTERACTIVE_SCALEDOWN_SECONDS = 300
BATCH_SCALEDOWN_SECONDS = 60
MAX_SCALEDOWN_SECONDS = 300
MAX_CONTAINERS_PER_POOL = 4
MAX_HOURLY_SPEND_USD = 5.0
MAX_TIMEOUT_SECONDS = 3600


class Gpu(StrEnum):
    T4 = "T4"
    L4 = "L4"
    A10G = "A10G"


GPU_MEMORY_MIB: dict[Gpu, int] = {
    Gpu.T4: 16 * MIB_PER_GIB,
    Gpu.L4: 24 * MIB_PER_GIB,
    Gpu.A10G: 24 * MIB_PER_GIB,
}

GPU_HOURLY_USD: dict[Gpu, float] = {
    Gpu.T4: 0.59,
    Gpu.L4: 0.80,
    Gpu.A10G: 1.10,
}


class Family(StrEnum):
    DETECTOR_BEST = "detector-best"
    DETECTOR_GOOD = "detector-good"
    TYPER_BEST = "typer-best"
    TYPER_GOOD = "typer-good"
    EMBEDDER = "embedder"


@dataclass(frozen=True)
class PoolLimits:
    family: Family
    gpu: Gpu | None
    gpu_memory_budget_mib: int
    memory_request_mib: int
    memory_limit_mib: int
    max_inputs: int
    max_containers: int
    timeout_seconds: int
    scaledown_window_seconds: int
    min_containers: int = 0
    buffer_containers: int = 0

    @property
    def function_name(self) -> str:
        return self.family.value.replace("-", "_")

    @property
    def hourly_usd_at_max(self) -> float:
        if self.gpu is None:
            return 0.0
        return GPU_HOURLY_USD[self.gpu] * self.max_containers


POOLS: tuple[PoolLimits, ...] = (
    PoolLimits(
        family=Family.DETECTOR_BEST,
        gpu=Gpu.L4,
        gpu_memory_budget_mib=20 * MIB_PER_GIB,
        memory_request_mib=8 * MIB_PER_GIB,
        memory_limit_mib=16 * MIB_PER_GIB,
        max_inputs=1,
        max_containers=2,
        timeout_seconds=MAX_TIMEOUT_SECONDS,
        scaledown_window_seconds=BATCH_SCALEDOWN_SECONDS,
    ),
    PoolLimits(
        family=Family.DETECTOR_GOOD,
        gpu=Gpu.T4,
        gpu_memory_budget_mib=12 * MIB_PER_GIB,
        memory_request_mib=6 * MIB_PER_GIB,
        memory_limit_mib=12 * MIB_PER_GIB,
        max_inputs=1,
        max_containers=2,
        timeout_seconds=MAX_TIMEOUT_SECONDS,
        scaledown_window_seconds=BATCH_SCALEDOWN_SECONDS,
    ),
    PoolLimits(
        family=Family.TYPER_BEST,
        gpu=Gpu.L4,
        gpu_memory_budget_mib=20 * MIB_PER_GIB,
        memory_request_mib=8 * MIB_PER_GIB,
        memory_limit_mib=16 * MIB_PER_GIB,
        max_inputs=1,
        max_containers=1,
        timeout_seconds=MAX_TIMEOUT_SECONDS,
        scaledown_window_seconds=BATCH_SCALEDOWN_SECONDS,
    ),
    PoolLimits(
        family=Family.TYPER_GOOD,
        gpu=Gpu.T4,
        gpu_memory_budget_mib=12 * MIB_PER_GIB,
        memory_request_mib=6 * MIB_PER_GIB,
        memory_limit_mib=12 * MIB_PER_GIB,
        max_inputs=1,
        max_containers=1,
        timeout_seconds=MAX_TIMEOUT_SECONDS,
        scaledown_window_seconds=BATCH_SCALEDOWN_SECONDS,
    ),
    PoolLimits(
        family=Family.EMBEDDER,
        gpu=Gpu.T4,
        gpu_memory_budget_mib=4 * MIB_PER_GIB,
        memory_request_mib=4 * MIB_PER_GIB,
        memory_limit_mib=8 * MIB_PER_GIB,
        max_inputs=4,
        max_containers=1,
        timeout_seconds=60,
        scaledown_window_seconds=INTERACTIVE_SCALEDOWN_SECONDS,
    ),
)


class FunctionOptions(TypedDict):
    gpu: str | None
    memory: tuple[int, int]
    max_containers: int
    min_containers: int
    buffer_containers: int
    scaledown_window: int
    timeout: int
    serialized: bool
    name: str


class ConcurrencyOptions(TypedDict):
    max_inputs: int


class PoolLimitError(ValueError):
    pass


def pool_problems(pool: PoolLimits) -> list[str]:
    problems: list[str] = []
    if pool.gpu is not None and pool.gpu_memory_budget_mib > GPU_MEMORY_MIB[pool.gpu]:
        problems.append("model GPU memory budget exceeds the card")
    if not 0 < pool.memory_request_mib <= pool.memory_limit_mib:
        problems.append("memory request must be positive and at most the limit")
    if pool.max_inputs < 1:
        problems.append("max_inputs must be at least 1")
    if not 1 <= pool.max_containers <= MAX_CONTAINERS_PER_POOL:
        problems.append("max_containers outside the per-pool cap")
    if pool.min_containers != 0 or pool.buffer_containers != 0:
        problems.append("pool must scale to zero when idle")
    if not 0 < pool.scaledown_window_seconds <= MAX_SCALEDOWN_SECONDS:
        problems.append("scaledown window outside the idle cap")
    if not 0 < pool.timeout_seconds <= MAX_TIMEOUT_SECONDS:
        problems.append("timeout outside the job cap")
    return problems


def validate_pools(pools: tuple[PoolLimits, ...]) -> None:
    families = [pool.family for pool in pools]
    if len(set(families)) != len(families):
        raise PoolLimitError("each model family has one pool")
    for pool in pools:
        problems = pool_problems(pool)
        if problems:
            raise PoolLimitError(f"{pool.family}: {'; '.join(problems)}")
    if worst_case_hourly_usd(pools) > MAX_HOURLY_SPEND_USD:
        raise PoolLimitError("all pools at their container cap exceed the hourly spend cap")


def worst_case_hourly_usd(pools: tuple[PoolLimits, ...]) -> float:
    return sum(pool.hourly_usd_at_max for pool in pools)


def function_options(pool: PoolLimits) -> FunctionOptions:
    return {
        "gpu": None if pool.gpu is None else pool.gpu.value,
        "memory": (pool.memory_request_mib, pool.memory_limit_mib),
        "max_containers": pool.max_containers,
        "min_containers": pool.min_containers,
        "buffer_containers": pool.buffer_containers,
        "scaledown_window": pool.scaledown_window_seconds,
        "timeout": pool.timeout_seconds,
        "serialized": True,
        "name": pool.function_name,
    }


def concurrency_options(pool: PoolLimits) -> ConcurrencyOptions:
    return {"max_inputs": pool.max_inputs}


def cpu_stand_in(pool: PoolLimits, max_containers: int) -> PoolLimits:
    return PoolLimits(
        family=pool.family,
        gpu=None,
        gpu_memory_budget_mib=0,
        memory_request_mib=256,
        memory_limit_mib=512,
        max_inputs=1,
        max_containers=max_containers,
        timeout_seconds=120,
        scaledown_window_seconds=2,
    )
