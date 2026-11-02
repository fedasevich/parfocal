import uuid
from collections.abc import Callable, Mapping
from functools import cache
from typing import Any

import httpx2
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.review_order import (
    ORDER_KIND,
    ORDER_LEASE_SECONDS,
    ORDER_STEP,
    ResultFilesMissingError,
    ResultFilesUnreadableError,
    order_of_slide,
    write_order,
)
from parfocal_api.review_tasks import sampling_scopes
from parfocal_api.tables import review_task_slides, review_tasks
from parfocal_common.jobs import (
    JobStatus,
    JobStoppedError,
    Step,
    StepFailedError,
    StepRun,
    Workflow,
    jobs,
)
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import StorageSettings, load_settings


async def still_mine(connection: AsyncConnection, step: StepRun) -> bool:
    status = await connection.scalar(
        select(jobs.c.status)
        .where(jobs.c.id == step.job_id, jobs.c.claimed_by == step.worker)
        .with_for_update(read=True)
    )
    return status == JobStatus.RUNNING


async def order_one_slide(
    connection: AsyncConnection,
    store: ResultStore,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    seed: int,
) -> None:
    task = (
        await connection.execute(
            select(review_tasks).where(
                review_tasks.c.id == task_id, review_tasks.c.archived_at.is_(None)
            )
        )
    ).one_or_none()
    set_id = await connection.scalar(
        select(review_task_slides.c.result_set_id).where(
            review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id
        )
    )
    if task is None or set_id is None:
        return
    try:
        keys = await order_of_slide(
            connection, store, sampling_scopes(task), slide_id, set_id, seed
        )
    except (ResultFilesMissingError, ResultFilesUnreadableError) as error:
        raise StepFailedError(error.code) from error
    await write_order(connection, task.tenant_id, task.project_id, task_id, slide_id, seed, keys)


async def order_slides(step: StepRun, store: ResultStore) -> Mapping[str, Any]:
    task_id = uuid.UUID(step.input["task_id"])
    slides = [(uuid.UUID(slide), int(seed)) for slide, seed in step.input["slides"]]
    done = await step.done_units()
    for unit, (slide_id, seed) in enumerate(slides):
        if unit in done:
            continue
        async with step.transaction() as connection:
            if not await still_mine(connection, step):
                raise JobStoppedError
            await order_one_slide(connection, store, task_id, slide_id, seed)
            await step.mark_unit(connection, unit)
    return {"slides": len(slides)}


def review_order_workflow(storage: Callable[[], StorageLocation]) -> Workflow:
    async def order_step(step: StepRun) -> Mapping[str, Any]:
        async with httpx2.AsyncClient(timeout=60) as http:
            return await order_slides(step, ObjectResultStore(ObjectStore(storage(), http)))

    return Workflow(
        kind=ORDER_KIND, steps=[Step(ORDER_STEP, order_step)], lease_seconds=ORDER_LEASE_SECONDS
    )


@cache
def storage_from_environment() -> StorageLocation:
    return load_settings(StorageSettings).storage()


REVIEW_ORDER = review_order_workflow(storage_from_environment)
