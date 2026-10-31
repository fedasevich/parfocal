import uuid
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_runs import require_run_reading
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.projects import visible
from parfocal_common.jobs import JobStatus, StepStatus, job_steps, job_units, jobs
from parfocal_common.model_runs import KIND as MODEL_RUN


class JobStep(BaseModel):
    name: str
    status: StepStatus
    runs: int
    units_done: int
    units_total: int | None
    started_at: datetime | None
    finished_at: datetime | None


class Job(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    kind: str
    status: JobStatus
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None
    steps: list[JobStep]


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get(
    "/{project_id}/jobs/{job_id}",
    operation_id="getProjectJob",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_project_job(
    project_id: uuid.UUID,
    job_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Job:
    await visible(connection, principal, project_id)
    row = (
        await connection.execute(
            select(jobs).where(jobs.c.id == job_id, jobs.c.project_id == project_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Job not found")
    if row.kind == MODEL_RUN:
        await require_run_reading(connection, principal, project_id, job_id)
    units = (
        select(func.count())
        .where(job_units.c.job_id == job_steps.c.job_id, job_units.c.ordinal == job_steps.c.ordinal)
        .scalar_subquery()
    )
    steps = await connection.execute(
        select(job_steps, units.label("units_done"))
        .where(job_steps.c.job_id == job_id)
        .order_by(job_steps.c.ordinal)
    )
    return Job(
        id=row.id,
        project_id=project_id,
        kind=row.kind,
        status=JobStatus(row.status),
        error_code=row.error_code,
        created_at=row.created_at,
        finished_at=row.finished_at,
        steps=[
            JobStep(
                name=step.name,
                status=StepStatus(step.status),
                runs=step.runs,
                units_done=step.units_done,
                units_total=step.units_total,
                started_at=step.started_at,
                finished_at=step.finished_at,
            )
            for step in steps
        ],
    )
