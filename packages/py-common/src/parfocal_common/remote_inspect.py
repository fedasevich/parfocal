import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue

KIND = "remote-inspect"
STEP_NAMES = ("inspect",)
LEASE_SECONDS = 60.0


class RunsInTheIngestWorkerError(RuntimeError):
    pass


async def runs_in_the_ingest_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheIngestWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_ingest_worker) for name in STEP_NAMES],
    lease_seconds=LEASE_SECONDS,
)


async def enqueue_remote_inspect(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, {"slide_id": str(slide_id)})


COPY_KIND = "remote-copy"
COPY_STEP_NAMES = ("copy",)

COPY_PLAN = Workflow(
    kind=COPY_KIND,
    steps=[Step(name, runs_in_the_ingest_worker) for name in COPY_STEP_NAMES],
    lease_seconds=LEASE_SECONDS,
)


async def enqueue_remote_copy(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, COPY_PLAN, tenant_id, project_id, {"slide_id": str(slide_id)})
