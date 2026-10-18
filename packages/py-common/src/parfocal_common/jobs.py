import asyncio
import importlib
import logging
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    Uuid,
    func,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.db import DatabaseScope, metadata, scoped_transaction

logger = logging.getLogger("parfocal.jobs")

PLATFORM = DatabaseScope(platform=True)


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


def timestamp(name: str, *, nullable: bool = True) -> Column[Any]:
    return Column(
        name,
        DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else func.now(),
        info=OPERATIONAL,
    )


jobs = Table(
    "jobs",
    metadata,
    Column(
        "id",
        Uuid[uuid.UUID](),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("project_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("kind", String(40), nullable=False, info=OPERATIONAL),
    Column("status", String(10), nullable=False, server_default="queued", info=OPERATIONAL),
    Column("input", JSONB, nullable=False, server_default="{}", info=OPERATIONAL),
    Column("claimed_by", String(80), nullable=True, info=OPERATIONAL),
    Column("claims", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("lease_until", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("error_code", String(60), nullable=True, info=OPERATIONAL),
    timestamp("created_at", nullable=False),
    timestamp("finished_at"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="status"),
    Index(
        "ix_jobs_claimable",
        "created_at",
        postgresql_where=text("status IN ('queued', 'running')"),
    ),
)

job_steps = Table(
    "job_steps",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("ordinal", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("name", String(40), nullable=False, info=OPERATIONAL),
    Column("status", String(10), nullable=False, server_default="pending", info=OPERATIONAL),
    Column("runs", Integer, nullable=False, server_default="0", info=OPERATIONAL),
    Column("result", JSONB, nullable=True, info=OPERATIONAL),
    timestamp("started_at"),
    timestamp("finished_at"),
    ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
    CheckConstraint("status IN ('pending', 'running', 'done', 'failed')", name="status"),
)

job_units = Table(
    "job_units",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("ordinal", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("unit", Integer, primary_key=True, info=OPERATIONAL),
    Column("worker", String(80), nullable=False, info=OPERATIONAL),
    timestamp("done_at", nullable=False),
    ForeignKeyConstraint(
        ["job_id", "ordinal"], ["job_steps.job_id", "job_steps.ordinal"], ondelete="CASCADE"
    ),
)


@dataclass(frozen=True)
class StepRun:
    engine: AsyncEngine
    job_id: uuid.UUID
    tenant_id: uuid.UUID
    project_id: uuid.UUID | None
    ordinal: int
    worker: str
    input: Mapping[str, Any]

    @property
    def scope(self) -> DatabaseScope:
        return DatabaseScope(tenant_id=self.tenant_id)

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncConnection]:
        async with scoped_transaction(self.engine, self.scope) as connection:
            yield connection

    async def done_units(self) -> frozenset[int]:
        async with self.transaction() as connection:
            rows = await connection.scalars(
                select(job_units.c.unit).where(
                    job_units.c.job_id == self.job_id, job_units.c.ordinal == self.ordinal
                )
            )
            return frozenset(rows.all())

    async def mark_unit(self, connection: AsyncConnection, unit: int) -> None:
        await connection.execute(
            insert(job_units).values(
                tenant_id=self.tenant_id,
                job_id=self.job_id,
                ordinal=self.ordinal,
                unit=unit,
                worker=self.worker,
            )
        )


type StepFunction = Callable[[StepRun], Awaitable[Mapping[str, Any] | None]]


@dataclass(frozen=True)
class Step:
    name: str
    run: StepFunction


@dataclass(frozen=True)
class Workflow:
    kind: str
    steps: Sequence[Step]
    lease_seconds: float = 60.0


@dataclass(frozen=True)
class Claimed:
    job_id: uuid.UUID
    tenant_id: uuid.UUID
    project_id: uuid.UUID | None
    kind: str
    input: Mapping[str, Any] = field(default_factory=dict[str, Any])


class StepFailedError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def enqueue(
    connection: AsyncConnection,
    workflow: Workflow,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
    job_input: Mapping[str, Any] | None = None,
) -> uuid.UUID:
    job_id = await connection.scalar(
        insert(jobs)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            kind=workflow.kind,
            input=dict(job_input or {}),
        )
        .returning(jobs.c.id)
    )
    assert isinstance(job_id, uuid.UUID)
    await connection.execute(
        insert(job_steps),
        [
            {"tenant_id": tenant_id, "job_id": job_id, "ordinal": ordinal, "name": step.name}
            for ordinal, step in enumerate(workflow.steps)
        ],
    )
    return job_id


def lease(seconds: float) -> Any:
    return func.clock_timestamp() + func.make_interval(0, 0, 0, 0, 0, 0, seconds)


async def claim(
    engine: AsyncEngine, worker: str, kinds: Mapping[str, Workflow]
) -> tuple[Claimed, Workflow] | None:
    async with scoped_transaction(engine, PLATFORM) as connection:
        claimable = (
            select(jobs.c.id)
            .where(
                jobs.c.kind.in_(list(kinds)),
                (jobs.c.status == JobStatus.QUEUED)
                | (
                    (jobs.c.status == JobStatus.RUNNING)
                    & (jobs.c.lease_until < func.clock_timestamp())
                ),
            )
            .order_by(jobs.c.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
            .scalar_subquery()
        )
        row = (
            await connection.execute(
                update(jobs)
                .where(jobs.c.id == claimable)
                .values(
                    status=JobStatus.RUNNING,
                    claimed_by=worker,
                    claims=jobs.c.claims + 1,
                    lease_until=lease(kinds_lease(kinds)),
                )
                .returning(
                    jobs.c.id, jobs.c.tenant_id, jobs.c.project_id, jobs.c.kind, jobs.c.input
                )
            )
        ).one_or_none()
    if row is None:
        return None
    workflow = kinds[row.kind]
    return Claimed(row.id, row.tenant_id, row.project_id, row.kind, row.input), workflow


def kinds_lease(kinds: Mapping[str, Workflow]) -> float:
    return max(workflow.lease_seconds for workflow in kinds.values())


async def renew(engine: AsyncEngine, job: Claimed, worker: str, seconds: float) -> None:
    while True:
        await asyncio.sleep(seconds / 3)
        async with scoped_transaction(engine, DatabaseScope(tenant_id=job.tenant_id)) as connection:
            await connection.execute(
                update(jobs)
                .where(jobs.c.id == job.job_id, jobs.c.claimed_by == worker)
                .values(lease_until=lease(seconds))
            )


async def finish(
    engine: AsyncEngine, job: Claimed, status: JobStatus, error_code: str | None = None
) -> None:
    async with scoped_transaction(engine, DatabaseScope(tenant_id=job.tenant_id)) as connection:
        await connection.execute(
            update(jobs)
            .where(jobs.c.id == job.job_id)
            .values(status=status, error_code=error_code, lease_until=None, finished_at=func.now())
        )


async def run_step(
    engine: AsyncEngine, job: Claimed, step: Step, ordinal: int, worker: str
) -> bool:
    scope = DatabaseScope(tenant_id=job.tenant_id)
    async with scoped_transaction(engine, scope) as connection:
        status = await connection.scalar(
            select(job_steps.c.status).where(
                job_steps.c.job_id == job.job_id, job_steps.c.ordinal == ordinal
            )
        )
        if status == StepStatus.DONE:
            logger.info("step skipped", extra={"job_id": str(job.job_id), "event": step.name})
            return True
        await connection.execute(
            update(job_steps)
            .where(job_steps.c.job_id == job.job_id, job_steps.c.ordinal == ordinal)
            .values(status=StepStatus.RUNNING, runs=job_steps.c.runs + 1, started_at=func.now())
        )
    run = StepRun(engine, job.job_id, job.tenant_id, job.project_id, ordinal, worker, job.input)
    try:
        result = await step.run(run)
    except StepFailedError as failure:
        async with scoped_transaction(engine, scope) as connection:
            await connection.execute(
                update(job_steps)
                .where(job_steps.c.job_id == job.job_id, job_steps.c.ordinal == ordinal)
                .values(status=StepStatus.FAILED, finished_at=func.now())
            )
        await finish(engine, job, JobStatus.FAILED, failure.code)
        return False
    async with scoped_transaction(engine, scope) as connection:
        await connection.execute(
            update(job_steps)
            .where(job_steps.c.job_id == job.job_id, job_steps.c.ordinal == ordinal)
            .values(
                status=StepStatus.DONE,
                result=dict(result) if result is not None else None,
                finished_at=func.now(),
            )
        )
    return True


async def run_job(engine: AsyncEngine, job: Claimed, workflow: Workflow, worker: str) -> None:
    heartbeat = asyncio.create_task(renew(engine, job, worker, workflow.lease_seconds))
    try:
        for ordinal, step in enumerate(workflow.steps):
            if not await run_step(engine, job, step, ordinal, worker):
                return
        await finish(engine, job, JobStatus.DONE)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat


async def work(
    engine: AsyncEngine,
    workflows: Sequence[Workflow],
    worker: str,
    idle_exit_seconds: float | None = None,
    poll_seconds: float = 1.0,
) -> int:
    kinds = {workflow.kind: workflow for workflow in workflows}
    finished = 0
    idle = 0.0
    while idle_exit_seconds is None or idle < idle_exit_seconds:
        claimed = await claim(engine, worker, kinds)
        if claimed is None:
            await asyncio.sleep(poll_seconds)
            idle += poll_seconds
            continue
        idle = 0.0
        job, workflow = claimed
        await run_job(engine, job, workflow, worker)
        finished += 1
    return finished


def load_workflow(path: str) -> Workflow:
    module_name, _, attribute = path.partition(":")
    workflow = getattr(importlib.import_module(module_name), attribute)
    assert isinstance(workflow, Workflow)
    return workflow
