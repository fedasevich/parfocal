import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue
from parfocal_common.link_fetch import LINK_FAILURES

KIND = "link-fetch"
STEP_NAMES = ("fetch",)
LEASE_SECONDS = 60.0


class LinkFailure(StrEnum):
    DUPLICATE = "duplicate"


LINK_IMPORT_FAILURES: Mapping[str, str] = {
    **{refusal.value: text for refusal, text in LINK_FAILURES.items()},
    LinkFailure.DUPLICATE: "Skipped, already in this project.",
}


SKIPPED_REASONS = frozenset({LinkFailure.DUPLICATE})
SKIPPED_MESSAGE = LINK_IMPORT_FAILURES[LinkFailure.DUPLICATE]


class RunsInTheIngestWorkerError(RuntimeError):
    pass


async def runs_in_the_ingest_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheIngestWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_ingest_worker) for name in STEP_NAMES],
    lease_seconds=LEASE_SECONDS,
)


def source_key(tenant_id: uuid.UUID, upload_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/quarantine/{upload_id}.link.json"


async def enqueue_link_fetch(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, {"upload_id": str(upload_id)})
