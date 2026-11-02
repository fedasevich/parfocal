import platform
import uuid
from dataclasses import dataclass, field

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    Uuid,
    func,
    insert,
)
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.data_classes import OPERATIONAL
from parfocal_common.db import metadata


def this_machine() -> str:
    return platform.node()[:80] or "unknown"


@dataclass(frozen=True)
class RunLabels:
    model: str | None = None
    model_version: str | None = None
    tier: str | None = None
    machine: str = field(default_factory=this_machine)


stage_throughput = Table(
    "stage_throughput",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("job_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("ordinal", SmallInteger, primary_key=True, info=OPERATIONAL),
    Column("run", Integer, primary_key=True, info=OPERATIONAL),
    Column("kind", String(40), nullable=False, info=OPERATIONAL),
    Column("stage", String(40), nullable=False, info=OPERATIONAL),
    Column("model", String(80), nullable=True, info=OPERATIONAL),
    Column("model_version", String(40), nullable=True, info=OPERATIONAL),
    Column("tier", String(20), nullable=True, info=OPERATIONAL),
    Column("machine", String(80), nullable=False, info=OPERATIONAL),
    Column("worker", String(80), nullable=False, info=OPERATIONAL),
    Column("units", Integer, nullable=False, info=OPERATIONAL),
    Column("seconds", Float[float](), nullable=False, info=OPERATIONAL),
    Column(
        "finished_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["job_id", "ordinal"], ["job_steps.job_id", "job_steps.ordinal"], ondelete="CASCADE"
    ),
    Index("ix_stage_throughput_model", "model", "model_version", "stage"),
)


@dataclass(frozen=True)
class StageSample:
    tenant_id: uuid.UUID
    job_id: uuid.UUID
    ordinal: int
    run: int
    kind: str
    stage: str
    worker: str
    units: int
    seconds: float


async def record_throughput(
    connection: AsyncConnection, sample: StageSample, labels: RunLabels
) -> None:
    await connection.execute(
        insert(stage_throughput).values(
            tenant_id=sample.tenant_id,
            job_id=sample.job_id,
            ordinal=sample.ordinal,
            run=sample.run,
            kind=sample.kind,
            stage=sample.stage,
            model=labels.model,
            model_version=labels.model_version,
            tier=labels.tier,
            machine=labels.machine,
            worker=sample.worker,
            units=sample.units,
            seconds=max(0.0, sample.seconds),
        )
    )
