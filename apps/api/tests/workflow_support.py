import asyncio
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from storage_support import TEST_STORAGE

from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.workflow import Resources, ingest_workflow

TILES = 20
DERIVED_PAUSE_SECONDS = 1.0


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


class SlowStore(ObjectStore):
    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        if not key.endswith("levels.json"):
            await asyncio.sleep(DERIVED_PAUSE_SECONDS)
        await super().put_object(key, body, content_type)


def slow_resources() -> Resources:
    return Resources(
        storage=TEST_STORAGE,
        work_dir=Path(os.environ["PARFOCAL_TEST_INGEST_DIR"]),
        store_class=SlowStore,
    )


SLOW_INGEST = ingest_workflow(slow_resources, lease_seconds=3)
