import asyncio
import uuid
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import (
    JobWaker,
    Step,
    StepRun,
    Workflow,
    enqueue,
    no_job_wake,
    set_job_waker,
)


async def nothing(run: StepRun) -> None:
    return None


PLAN = Workflow("test-kind", [Step("only", nothing)])


class FakeConnection:
    def __init__(self) -> None:
        self.job_id = uuid.uuid4()
        self.executed = 0

    async def scalar(self, statement: Any) -> uuid.UUID:
        return self.job_id

    async def execute(self, statement: Any, rows: Any = None) -> None:
        self.executed += 1


def enqueued_with(waker: JobWaker) -> tuple[uuid.UUID, FakeConnection]:
    connection = FakeConnection()
    set_job_waker(waker)
    try:
        job_id = asyncio.run(enqueue(cast("AsyncConnection", connection), PLAN, uuid.uuid4()))
    finally:
        set_job_waker(no_job_wake)
    return job_id, connection


def test_enqueueing_wakes_the_worker_with_the_job_kind() -> None:
    woken: list[str] = []

    async def counting(kind: str) -> None:
        woken.append(kind)

    job_id, connection = enqueued_with(counting)
    assert job_id == connection.job_id
    assert connection.executed == 1
    assert woken == ["test-kind"]


def test_a_failed_wake_does_not_fail_the_enqueue() -> None:
    async def broken(kind: str) -> None:
        raise RuntimeError("modal is down")

    job_id, connection = enqueued_with(broken)
    assert job_id == connection.job_id
