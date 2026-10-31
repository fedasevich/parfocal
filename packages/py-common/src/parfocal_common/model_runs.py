import uuid
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    Table,
    Uuid,
    insert,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_common.data_classes import OPERATIONAL, PERSONAL
from parfocal_common.db import DatabaseScope, metadata, scoped_transaction
from parfocal_common.jobs import (
    Claimed,
    Step,
    StepFunction,
    StepRun,
    Workflow,
    claim,
    enqueue,
    timestamp,
)

KIND = "model-run"
STAGES = (
    "tiles-read",
    "tissue-found",
    "model-running",
    "objects-placed",
    "ids-given",
    "result-set-added",
)
LEASE_SECONDS = 60.0
TEST_TIME_VIEWS = (1, 8)


class RunScopeKind(StrEnum):
    VIEW = "view"
    SELECTION = "selection"
    SLIDE = "slide"


class Ordering(StrEnum):
    RASTER = "raster"
    TUMOR_FIRST = "tumor-first"


def one_of(column: str, values: tuple[object, ...]) -> CheckConstraint:
    allowed = ", ".join(f"'{value}'" if isinstance(value, str) else str(value) for value in values)
    return CheckConstraint(f"{column} IN ({allowed})", name=column)


model_runs = Table(
    "model_runs",
    metadata,
    Column("job_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column("batch_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("scope_kind", String(10), nullable=False, info=OPERATIONAL),
    Column("scope", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("detector", String(80), nullable=False, info=OPERATIONAL),
    Column("detector_version", String(40), nullable=False, info=OPERATIONAL),
    Column("typer", String(80), nullable=True, info=OPERATIONAL),
    Column("typer_version", String(40), nullable=True, info=OPERATIONAL),
    Column("test_time_views", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("ordering", String(12), nullable=False, info=OPERATIONAL),
    Column(
        "started_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    timestamp("created_at", nullable=False),
    ForeignKeyConstraint(["job_id"], ["jobs.id"]),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(["task_id", "project_id"], ["review_tasks.id", "review_tasks.project_id"]),
    one_of("scope_kind", tuple(RunScopeKind)),
    one_of("ordering", tuple(Ordering)),
    one_of("test_time_views", TEST_TIME_VIEWS),
    CheckConstraint("(scope_kind = 'slide') = (scope IS NULL)", name="scope"),
    CheckConstraint("(typer IS NULL) = (typer_version IS NULL)", name="typer_version"),
    CheckConstraint("test_time_views = 1 OR typer IS NOT NULL", name="views_need_typer"),
    Index("ix_model_runs_project_id_created_at", "project_id", "created_at"),
)


@dataclass(frozen=True)
class RunSettings:
    scope_kind: RunScopeKind
    scope: Mapping[str, Any] | None
    detector: str
    detector_version: str
    typer: str | None = None
    typer_version: str | None = None
    test_time_views: int = 1
    ordering: Ordering = Ordering.RASTER


@dataclass(frozen=True)
class ClaimedRun:
    job: Claimed
    workflow: Workflow
    slide_id: uuid.UUID
    task_id: uuid.UUID | None
    settings: RunSettings


class RunsInTheModelWorkerError(RuntimeError):
    pass


async def runs_in_the_model_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheModelWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_model_worker) for name in STAGES],
    lease_seconds=LEASE_SECONDS,
)


def workflow(stages: Mapping[str, StepFunction], lease_seconds: float = LEASE_SECONDS) -> Workflow:
    if set(stages) != set(STAGES):
        raise ValueError(f"A model run has the stages {', '.join(STAGES)}")
    return Workflow(KIND, [Step(name, stages[name]) for name in STAGES], lease_seconds)


async def enqueue_model_run(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    settings: RunSettings,
    *,
    batch_id: uuid.UUID,
    task_id: uuid.UUID | None = None,
    started_by: uuid.UUID | None = None,
) -> uuid.UUID:
    job_id = await enqueue(connection, PLAN, tenant_id, project_id, {"slide_id": str(slide_id)})
    values = asdict(settings)
    values["scope"] = dict(settings.scope) if settings.scope is not None else None
    await connection.execute(
        insert(model_runs).values(
            job_id=job_id,
            tenant_id=tenant_id,
            project_id=project_id,
            slide_id=slide_id,
            task_id=task_id,
            batch_id=batch_id,
            started_by_user_id=started_by,
            **values,
        )
    )
    return job_id


def settings_of(row: Any) -> RunSettings:
    return RunSettings(
        scope_kind=RunScopeKind(row.scope_kind),
        scope=row.scope,
        detector=row.detector,
        detector_version=row.detector_version,
        typer=row.typer,
        typer_version=row.typer_version,
        test_time_views=row.test_time_views,
        ordering=Ordering(row.ordering),
    )


async def claim_model_run(
    engine: AsyncEngine,
    worker: str,
    plan: Workflow = PLAN,
    tenant_id: uuid.UUID | None = None,
) -> ClaimedRun | None:
    claimed = await claim(engine, worker, {KIND: plan}, tenant_id)
    if claimed is None:
        return None
    job, chosen = claimed
    async with scoped_transaction(engine, DatabaseScope(tenant_id=job.tenant_id)) as connection:
        row = (
            await connection.execute(select(model_runs).where(model_runs.c.job_id == job.job_id))
        ).one()
    return ClaimedRun(job, chosen, row.slide_id, row.task_id, settings_of(row))
