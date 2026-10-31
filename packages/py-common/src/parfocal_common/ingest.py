import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue

KIND = "ingest"
STEP_NAMES = ("quarantine", "scan", "identify", "validate", "index", "derive", "publish")
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


def job_input(upload_id: uuid.UUID) -> dict[str, str]:
    return {"upload_id": str(upload_id)}


async def enqueue_ingest(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, job_input(upload_id))
