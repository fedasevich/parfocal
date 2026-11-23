import logging
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import NamedTuple, cast

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.model_runs import NUCLEI_POOL_FUNCTION, wake_nuclei_pool
from parfocal_common.warm_gate import PoolLoad, PoolLoads, Pools

logger = logging.getLogger("parfocal.api.run_waits")

LOAD_FRESH_SECONDS = 10.0
WAKE_AGAIN_AFTER_SECONDS = 60.0
WOKEN_AGAIN = "woken_again_at"


class RunWaitReason(StrEnum):
    WAITING_FOR_GPU = "waiting-for-gpu"
    GPU_BUSY = "gpu-busy"
    WOKEN_AGAIN = "woken-again"


class RunWait(BaseModel):
    reason: RunWaitReason
    since: datetime


class QueuedRun(NamedTuple):
    job_id: uuid.UUID
    created_at: datetime
    woken_again: bool


@dataclass
class PoolWatch:
    loads: PoolLoads
    pools: Pools
    clock: Callable[[], float] = time.monotonic
    function_name: str = NUCLEI_POOL_FUNCTION
    lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    read_at: float | None = field(default=None, init=False)
    last: PoolLoad | None = field(default=None, init=False)

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
        with self.lock:
            self.read_at = None
        woken = wake_nuclei_pool(self.pools)
        logger.info("queued model run woke its pool again", extra={"woken": woken})
        return woken


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


async def mark_woken(connection: AsyncConnection, job_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    marker = func.jsonb_build_object(WOKEN_AGAIN, func.now())
    marked = await connection.scalars(
        update(jobs)
        .where(
            jobs.c.id.in_(job_ids),
            jobs.c.status == JobStatus.QUEUED,
            ~jobs.c.input.has_key(WOKEN_AGAIN),
        )
        .values(input=jobs.c.input.op("||")(marker))
        .returning(jobs.c.id)
    )
    return list(marked)


async def unmark_woken(connection: AsyncConnection, job_ids: list[uuid.UUID]) -> None:
    await connection.execute(
        update(jobs).where(jobs.c.id.in_(job_ids)).values(input=jobs.c.input.op("-")(WOKEN_AGAIN))
    )


async def woken_again(
    connection: AsyncConnection, watch: PoolWatch, due: list[uuid.UUID]
) -> set[uuid.UUID]:
    if not due:
        return set()
    marked = await mark_woken(connection, due)
    if not marked:
        return set()
    if await run_in_threadpool(watch.wake_again):
        return set(marked)
    await unmark_woken(connection, marked)
    return set()


async def run_waits(
    connection: AsyncConnection,
    watch: PoolWatch | None,
    queued: Sequence[QueuedRun],
    now: datetime,
) -> dict[uuid.UUID, RunWait]:
    if watch is None or not queued:
        return {}
    load = await run_in_threadpool(watch.load)
    if load is None:
        return {}
    if load.runners > 0 or load.backlog > 0:
        reason = RunWaitReason.GPU_BUSY if load.runners > 0 else RunWaitReason.WAITING_FOR_GPU
        return {run.job_id: RunWait(reason=reason, since=run.created_at) for run in queued}
    due = [
        run.job_id
        for run in queued
        if not run.woken_again
        and (now - run.created_at).total_seconds() >= WAKE_AGAIN_AFTER_SECONDS
    ]
    woken = await woken_again(connection, watch, due)
    return {
        run.job_id: RunWait(reason=RunWaitReason.WOKEN_AGAIN, since=run.created_at)
        for run in queued
        if run.woken_again or run.job_id in woken
    }
