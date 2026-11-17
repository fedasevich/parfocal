import uuid
from collections.abc import Callable, Mapping
from typing import Any

import httpx2
from sqlalchemy import select

from parfocal_api.cell_crop_jobs import CROP_KIND, CROP_LEASE_SECONDS, CROP_STEP
from parfocal_api.review_order_job import still_mine
from parfocal_api.tables import slides
from parfocal_common.jobs import JobStoppedError, Step, StepRun, Workflow
from parfocal_ingest.cell_crops import NONE, Isolation, crop_slide, picked_on
from parfocal_ingest.workflow import Resources, resources_from_environment


async def cut_ordered_cells(step: StepRun, resources: Resources) -> Mapping[str, Any]:
    slide_id = uuid.UUID(step.input["slide_id"])
    async with httpx2.AsyncClient(timeout=120) as http:
        store = resources.store_class(resources.storage, http)
        async with step.transaction() as connection:
            if not await still_mine(connection, step):
                raise JobStoppedError
            original = await connection.scalar(
                select(slides.c.original_key).where(
                    slides.c.id == slide_id, slides.c.deleted_at.is_(None)
                )
            )
            if original is None:
                return {"state": NONE}
            picks = await picked_on(connection, store, step.tenant_id, slide_id)
        state = await crop_slide(
            store,
            step.tenant_id,
            slide_id,
            original,
            picks,
            resources.work_dir,
            Isolation(resources.parse_limits, resources.parse_tokens),
        )
    return {"state": state}


def cell_crop_workflow(resources: Callable[[], Resources]) -> Workflow:
    async def cut_step(step: StepRun) -> Mapping[str, Any]:
        return await cut_ordered_cells(step, resources())

    return Workflow(
        kind=CROP_KIND, steps=[Step(CROP_STEP, cut_step)], lease_seconds=CROP_LEASE_SECONDS
    )


CELL_CROPS = cell_crop_workflow(resources_from_environment)
