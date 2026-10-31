from collections.abc import Mapping
from typing import Any

from parfocal_common.ingest import KIND, LEASE_SECONDS, STEP_NAMES
from parfocal_common.jobs import Step, StepRun, Workflow

__all__ = ["INGEST", "STEP_NAMES"]


def placeholder(name: str) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        return {"step": name, "placeholder": True}

    return Step(name, run)


INGEST = Workflow(
    kind=KIND, steps=[placeholder(name) for name in STEP_NAMES], lease_seconds=LEASE_SECONDS
)
