import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import JobStatus, Step, StepRun, Workflow, enqueue, jobs

CROP_KIND = "cell-crops"
CROP_STEP = "cut"
CROP_LEASE_SECONDS = 600.0


class CropsRunInAWorkerError(RuntimeError):
    pass


async def runs_in_a_worker(step: StepRun) -> Mapping[str, Any]:
    raise CropsRunInAWorkerError(step.job_id)


CROP_PLAN = Workflow(
    kind=CROP_KIND, steps=[Step(CROP_STEP, runs_in_a_worker)], lease_seconds=CROP_LEASE_SECONDS
)


async def queue_crops(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID | None,
    slide_id: uuid.UUID,
) -> uuid.UUID | None:
    waiting = await connection.scalar(
        select(jobs.c.id)
        .where(
            jobs.c.kind == CROP_KIND,
            jobs.c.status == JobStatus.QUEUED,
            jobs.c.input["slide_id"].astext == str(slide_id),
        )
        .limit(1)
    )
    if waiting is not None:
        return None
    return await enqueue(connection, CROP_PLAN, tenant_id, project_id, {"slide_id": str(slide_id)})
