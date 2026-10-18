from collections.abc import Mapping
from typing import Any

from parfocal_common.jobs import Step, StepRun, Workflow

STEP_NAMES = ("quarantine", "scan", "identify", "validate", "index", "derive", "publish")


def placeholder(name: str) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        return {"step": name, "placeholder": True}

    return Step(name, run)


INGEST = Workflow(kind="ingest", steps=[placeholder(name) for name in STEP_NAMES], lease_seconds=60)
