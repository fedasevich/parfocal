import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, func, select

from parfocal_api.context import TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import gpu_usage, jobs, model_runs

LISTED_JOBS = 200


class AiUsageModel(BaseModel):
    model: str | None
    model_version: str | None
    gpu_seconds: float
    jobs: int


class AiUsageJob(BaseModel):
    job_id: uuid.UUID
    kind: str
    project_id: uuid.UUID | None
    slide_id: uuid.UUID | None
    model: str | None
    model_version: str | None
    gpu_seconds: float
    last_recorded_at: datetime


class AiUsage(BaseModel):
    since: datetime | None
    until: datetime | None
    gpu_seconds: float
    jobs: int
    models: list[AiUsageModel]
    recent_jobs: list[AiUsageJob]


class UsageRangeError(BadRequestError):
    code = "usage-range-invalid"
    title = "The usage range must end after it starts"


router = APIRouter(prefix="/api/tenant", tags=["tenant"])


def within(since: datetime | None, until: datetime | None) -> ColumnElement[bool]:
    conditions: list[ColumnElement[bool]] = []
    if since is not None:
        conditions.append(gpu_usage.c.recorded_at >= since)
    if until is not None:
        conditions.append(gpu_usage.c.recorded_at < until)
    return and_(True, *conditions)


def model_of(row: Any) -> AiUsageModel:
    return AiUsageModel(
        model=row.model,
        model_version=row.model_version,
        gpu_seconds=float(row.gpu_seconds),
        jobs=row.jobs,
    )


def job_of(row: Any) -> AiUsageJob:
    return AiUsageJob(
        job_id=row.job_id,
        kind=row.kind,
        project_id=row.project_id,
        slide_id=row.slide_id,
        model=row.model,
        model_version=row.model_version,
        gpu_seconds=float(row.gpu_seconds),
        last_recorded_at=row.last_recorded_at,
    )


@router.get("/ai-usage", operation_id="getAiUsage", **require(Permission.WORKSPACE_SETTINGS))
async def get_ai_usage(
    connection: TenantConnection,
    since: datetime | None = None,
    until: datetime | None = None,
) -> AiUsage:
    if since is not None and until is not None and until <= since:
        raise UsageRangeError()
    window = within(since, until)
    seconds = func.coalesce(func.sum(gpu_usage.c.seconds), 0.0).label("gpu_seconds")
    counted = func.count(gpu_usage.c.job_id.distinct()).label("jobs")
    total = (await connection.execute(select(seconds, counted).where(window))).one()
    models = await connection.execute(
        select(gpu_usage.c.model, gpu_usage.c.model_version, seconds, counted)
        .where(window)
        .group_by(gpu_usage.c.model, gpu_usage.c.model_version)
        .order_by(seconds.desc(), gpu_usage.c.model, gpu_usage.c.model_version)
    )
    last = func.max(gpu_usage.c.recorded_at).label("last_recorded_at")
    recent = await connection.execute(
        select(
            gpu_usage.c.job_id,
            gpu_usage.c.kind,
            gpu_usage.c.model,
            gpu_usage.c.model_version,
            jobs.c.project_id,
            model_runs.c.slide_id,
            seconds,
            last,
        )
        .select_from(
            gpu_usage.join(jobs, jobs.c.id == gpu_usage.c.job_id).outerjoin(
                model_runs, model_runs.c.job_id == gpu_usage.c.job_id
            )
        )
        .where(window)
        .group_by(
            gpu_usage.c.job_id,
            gpu_usage.c.kind,
            gpu_usage.c.model,
            gpu_usage.c.model_version,
            jobs.c.project_id,
            model_runs.c.slide_id,
        )
        .order_by(last.desc(), gpu_usage.c.job_id)
        .limit(LISTED_JOBS)
    )
    return AiUsage(
        since=since,
        until=until,
        gpu_seconds=float(total.gpu_seconds),
        jobs=total.jobs,
        models=[model_of(row) for row in models],
        recent_jobs=[job_of(row) for row in recent],
    )
