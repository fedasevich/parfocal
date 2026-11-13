import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.review_tasks import code_of, readable_task
from parfocal_api.tables import review_task_slides
from parfocal_api.task_kinds import annotate_only
from parfocal_api.training_exports import DatasetHiddenError, NothingSignedOffError
from parfocal_common.jobs import JobStatus, Step, StepRun, Workflow, enqueue, jobs

PATCH_KIND = "patch-export"
PATCH_STEP = "export"
PATCH_LEASE_SECONDS = 300.0
SMALLEST_TILE = 64
LARGEST_TILE = 2048
DEFAULT_TILE = 512
DEEPEST_LEVEL = 16


class PatchExportNotReadyError(ConflictError):
    code = "patch-export-not-ready"
    title = "The patches of this task are still being cut"


class PatchExportFailedError(ConflictError):
    code = "patch-export-failed"
    title = "The patches of this task could not be cut"


class PatchRunsInAWorkerError(RuntimeError):
    pass


async def runs_in_a_worker(step: StepRun) -> Mapping[str, Any]:
    raise PatchRunsInAWorkerError(step.job_id)


PATCH_PLAN = Workflow(
    kind=PATCH_KIND, steps=[Step(PATCH_STEP, runs_in_a_worker)], lease_seconds=PATCH_LEASE_SECONDS
)


def patch_export_key(tenant_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/exports/patches/{job_id}.zip"


class PatchExportRequest(BaseModel):
    level: int = Field(default=0, ge=0, le=DEEPEST_LEVEL)
    tile_size: int = Field(default=DEFAULT_TILE, ge=SMALLEST_TILE, le=LARGEST_TILE)


class PatchExportStarted(BaseModel):
    job_id: uuid.UUID


router = APIRouter(prefix="/api/review-tasks/{task_id}/patch-exports", tags=["review-tasks"])


@router.post(
    "",
    operation_id="startPatchExport",
    status_code=202,
    **require(Permission.SEE_SLIDES, write=True, emergency=True),
)
async def start_patch_export(
    task_id: uuid.UUID,
    body: PatchExportRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PatchExportStarted:
    task, whole = await readable_task(connection, principal, task_id)
    annotate_only(task.kind)
    if not whole:
        raise DatasetHiddenError
    signed = await connection.scalar(
        select(review_task_slides.c.slide_id)
        .where(
            review_task_slides.c.task_id == task_id,
            review_task_slides.c.signed_off_at.is_not(None),
        )
        .limit(1)
    )
    if signed is None:
        raise NothingSignedOffError
    job_id = await enqueue(
        connection,
        PATCH_PLAN,
        task.tenant_id,
        task.project_id,
        {"task_id": str(task_id), "level": body.level, "tile_size": body.tile_size},
    )
    return PatchExportStarted(job_id=job_id)


@router.get(
    "/{job_id}",
    operation_id="downloadPatchExport",
    response_class=Response,
    responses={
        200: {
            "description": "A zip of tiles, label masks, the GeoJSON they came from and an index",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def download_patch_export(
    task_id: uuid.UUID,
    job_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> Response:
    task, whole = await readable_task(connection, principal, task_id)
    annotate_only(task.kind)
    if not whole:
        raise DatasetHiddenError
    status = await connection.scalar(
        select(jobs.c.status).where(
            jobs.c.id == job_id,
            jobs.c.kind == PATCH_KIND,
            jobs.c.input["task_id"].astext == str(task_id),
        )
    )
    if status is None:
        raise NotFoundError("Patch export not found")
    if status in {JobStatus.FAILED, JobStatus.CANCELLED}:
        raise PatchExportFailedError
    if status != JobStatus.DONE:
        raise PatchExportNotReadyError
    content = await store.get_object(patch_export_key(task.tenant_id, job_id))
    return Response(
        content,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="parfocal-{code_of(task.number)}-patches.zip"'
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )
