import logging
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import cast

from fastapi import Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from parfocal_common.model_runs import NUCLEI_POOL_FUNCTION, wake_nuclei_pool
from parfocal_common.warm_gate import PoolLoad, PoolLoads, Pools

logger = logging.getLogger("parfocal.api.run_waits")

LOAD_FRESH_SECONDS = 10.0
WAKE_AGAIN_AFTER_SECONDS = 60.0


class RunWaitReason(StrEnum):
    WAITING_FOR_GPU = "waiting-for-gpu"
    GPU_BUSY = "gpu-busy"
    WOKEN_AGAIN = "woken-again"


class RunWait(BaseModel):
    reason: RunWaitReason
    since: datetime


@dataclass
class PoolWatch:
    loads: PoolLoads
    pools: Pools
    clock: Callable[[], float] = time.monotonic
    function_name: str = NUCLEI_POOL_FUNCTION
    lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    read_at: float | None = field(default=None, init=False)
    last: PoolLoad | None = field(default=None, init=False)
    woken_at: float | None = field(default=None, init=False)
    woke: bool = field(default=False, init=False)

    def load(self) -> PoolLoad | None:
        now = self.clock()
        with self.lock:
            if self.read_at is not None and now - self.read_at < LOAD_FRESH_SECONDS:
                return self.last
        try:
            found: PoolLoad | None = self.loads.load(self.function_name)
        except Exception as error:
            logger.warning("pool load read failed: %s", type(error).__name__)
            found = None
        with self.lock:
            self.read_at, self.last = now, found
        return found

    def wake_again(self) -> bool:
        now = self.clock()
        with self.lock:
            if self.woken_at is not None and now - self.woken_at < WAKE_AGAIN_AFTER_SECONDS:
                return self.woke
            self.woken_at = now
            self.read_at = None
        woken = wake_nuclei_pool(self.pools)
        logger.info("queued model run woke its pool again", extra={"woken": woken})
        with self.lock:
            self.woke = woken
        return woken

    def reason(self, waited_seconds: float) -> RunWaitReason | None:
        load = self.load()
        if load is None:
            return None
        if load.runners > 0:
            return RunWaitReason.GPU_BUSY
        if load.backlog > 0:
            return RunWaitReason.WAITING_FOR_GPU
        if waited_seconds < WAKE_AGAIN_AFTER_SECONDS:
            return None
        return RunWaitReason.WOKEN_AGAIN if self.wake_again() else None


def pool_watch_of(request: Request) -> PoolWatch | None:
    state = request.app.state
    pools = getattr(state, "gpu_pools", None)
    if not isinstance(pools, PoolLoads):
        return None
    watch = getattr(state, "pool_watch", None)
    if not isinstance(watch, PoolWatch) or watch.loads is not pools:
        watch = PoolWatch(pools, cast("Pools", pools))
        state.pool_watch = watch
    return watch


async def run_waits(
    watch: PoolWatch | None, queued: Sequence[tuple[uuid.UUID, datetime]], now: datetime
) -> dict[uuid.UUID, RunWait]:
    if watch is None or not queued:
        return {}
    oldest = min(created for _, created in queued)
    reason = await run_in_threadpool(watch.reason, (now - oldest).total_seconds())
    if reason is None:
        return {}
    return {job_id: RunWait(reason=reason, since=created) for job_id, created in queued}
