import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Claimed, Step, StepFunction, StepRun, Workflow, enqueue
from parfocal_common.warm_gate import Pools

logger = logging.getLogger("parfocal.tumor_maps")

KIND = "tumor-map"
POOL_FUNCTION = "detector_good"
SCORED = "map-scored"
STORED = "map-stored"
STEPS = (SCORED, STORED)
LEASE_SECONDS = 60.0
MODEL = "camelyon-tumor"
MODEL_VERSION = "v1.0"
MAX_TILES = 4000


def tiles_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/s/{slide_id}/maps/{job_id}/"


def tile_key(prefix: str, index: int) -> str:
    return f"{prefix}tiles/tile-{index:06}.bin"


@dataclass(frozen=True)
class TumorMapInput:
    slide_id: uuid.UUID
    result_set_id: uuid.UUID

    def described(self) -> dict[str, str]:
        return {"slide_id": str(self.slide_id), "result_set_id": str(self.result_set_id)}


def input_of(values: Mapping[str, Any]) -> TumorMapInput:
    return TumorMapInput(uuid.UUID(values["slide_id"]), uuid.UUID(values["result_set_id"]))


def claimed_input(job: Claimed | StepRun) -> TumorMapInput:
    return input_of(job.input)


class RunsInTheModelWorkerError(RuntimeError):
    pass


async def runs_in_the_model_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheModelWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_model_worker) for name in STEPS],
    lease_seconds=LEASE_SECONDS,
)


def workflow(steps: Mapping[str, StepFunction], lease_seconds: float = LEASE_SECONDS) -> Workflow:
    if set(steps) != set(STEPS):
        raise ValueError(f"A tumor map has the steps {', '.join(STEPS)}")
    return Workflow(KIND, [Step(name, steps[name]) for name in STEPS], lease_seconds)


async def enqueue_tumor_map(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    job_input: TumorMapInput,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, job_input.described())


def drain_call() -> dict[str, object]:
    return {"kind": KIND}


def wake_tumor_map_pool(pools: Pools) -> bool:
    try:
        pools.spawn(POOL_FUNCTION, drain_call())
    except Exception as error:
        logger.warning("tumor map pool spawn failed: %s", type(error).__name__)
        return False
    return True
