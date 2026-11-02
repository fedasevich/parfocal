import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_runs import readable_run
from parfocal_api.permissions import Permission, require
from parfocal_api.tables import job_steps, job_units
from parfocal_common.jobs import JobStatus

MAX_AREAS = 1000


class RunArea(BaseModel):
    seq: int
    stage: str
    unit: int
    x: int
    y: int
    width: int
    height: int
    objects: int
    done_at: datetime


class RunAreas(BaseModel):
    run_id: uuid.UUID
    status: JobStatus
    areas: list[RunArea]
    after: int
    more: bool


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get(
    "/{project_id}/model-runs/{run_id}/areas",
    operation_id="listModelRunAreas",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_model_run_areas(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    after: Annotated[int, Query(ge=0)] = 0,
) -> RunAreas:
    run = await readable_run(connection, principal, project_id, run_id)
    rows = (
        await connection.execute(
            select(job_units, job_steps.c.name.label("stage"))
            .join(
                job_steps,
                (job_steps.c.job_id == job_units.c.job_id)
                & (job_steps.c.ordinal == job_units.c.ordinal),
            )
            .where(
                job_units.c.job_id == run_id,
                job_units.c.seq > after,
                job_units.c.result.is_not(None),
            )
            .order_by(job_units.c.seq)
            .limit(MAX_AREAS + 1)
        )
    ).all()
    areas = [
        RunArea(
            seq=row.seq,
            stage=row.stage,
            unit=row.unit,
            x=row.result["x"],
            y=row.result["y"],
            width=row.result["width"],
            height=row.result["height"],
            objects=row.result["objects"],
            done_at=row.done_at,
        )
        for row in rows[:MAX_AREAS]
    ]
    return RunAreas(
        run_id=run_id,
        status=JobStatus(run.status),
        areas=areas,
        after=areas[-1].seq if areas else after,
        more=len(rows) > MAX_AREAS,
    )
