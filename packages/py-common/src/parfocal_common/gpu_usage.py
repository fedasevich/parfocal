import uuid

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Float,
    ForeignKeyConstraint,
    Identity,
    Index,
    String,
    Table,
    Uuid,
    func,
    insert,
    select,
)
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.db import metadata
from parfocal_common.jobs import StepRun, jobs
from parfocal_common.model_runs import model_runs

MAX_REPORTED_SECONDS = 24 * 60 * 60.0

gpu_usage = Table(
    "gpu_usage",
    metadata,
    Column("id", BigInteger, Identity(always=True), primary_key=True, info=OPERATIONAL),
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("kind", String(40), nullable=False, info=OPERATIONAL),
    Column("model", String(80), nullable=True, info=OPERATIONAL),
    Column("model_version", String(40), nullable=True, info=OPERATIONAL),
    Column("tier", String(20), nullable=True, info=OPERATIONAL),
    Column("gpu", String(40), nullable=True, info=OPERATIONAL),
    Column("worker", String(80), nullable=False, info=OPERATIONAL),
    Column("seconds", Float[float](), nullable=False, info=OPERATIONAL),
    Column(
        "recorded_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
    Index("ix_gpu_usage_tenant_id_recorded_at", "tenant_id", "recorded_at"),
)


class ReportedSecondsError(ValueError):
    pass


def checked_seconds(seconds: float) -> float:
    if not 0.0 <= seconds <= MAX_REPORTED_SECONDS:
        raise ReportedSecondsError(seconds)
    return float(seconds)


async def record_gpu_seconds(
    connection: AsyncConnection, step: StepRun, seconds: float, gpu: str | None = None
) -> None:
    reported = checked_seconds(seconds)
    kind = await connection.scalar(select(jobs.c.kind).where(jobs.c.id == step.job_id))
    run = (
        await connection.execute(
            select(model_runs.c.detector, model_runs.c.detector_version, model_runs.c.tier).where(
                model_runs.c.job_id == step.job_id
            )
        )
    ).one_or_none()
    await connection.execute(
        insert(gpu_usage).values(
            tenant_id=step.tenant_id,
            job_id=step.job_id,
            kind=kind,
            model=run.detector if run is not None else None,
            model_version=run.detector_version if run is not None else None,
            tier=run.tier if run is not None else None,
            gpu=gpu,
            worker=step.worker,
            seconds=reported,
        )
    )


async def report_gpu_seconds(step: StepRun, seconds: float, gpu: str | None = None) -> None:
    async with step.transaction() as connection:
        await record_gpu_seconds(connection, step, seconds, gpu)
