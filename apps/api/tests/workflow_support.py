import asyncio
from collections.abc import Mapping
from typing import Any

from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow

TILES = 20


async def scan(step: StepRun) -> Mapping[str, Any]:
    await asyncio.sleep(0.3)
    return {"clean": True}


async def derive(step: StepRun) -> Mapping[str, Any]:
    done = await step.done_units()
    for unit in range(TILES):
        if unit in done:
            continue
        await asyncio.sleep(0.15)
        async with step.transaction() as connection:
            await step.mark_unit(connection, unit)
    return {"tiles": TILES}


async def publish(step: StepRun) -> Mapping[str, Any]:
    await asyncio.sleep(0.2)
    return {"published": True}


async def broken(step: StepRun) -> Mapping[str, Any]:
    raise StepFailedError("unreadable-file")


SLOW = Workflow(
    kind="test-slow",
    steps=[Step("scan", scan), Step("derive", derive), Step("publish", publish)],
    lease_seconds=3,
)
FAILING = Workflow(
    kind="test-failing",
    steps=[Step("scan", scan), Step("identify", broken), Step("publish", publish)],
    lease_seconds=3,
)
