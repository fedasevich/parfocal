import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.dataset_versions import version_row
from parfocal_api.final_layers import current_layers
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.review_tasks import code_of, readable_task
from parfocal_api.tables import TaskKind
from parfocal_api.training_exports import (
    DatasetHiddenError,
    NothingSignedOffError,
    signed_off_slides,
)
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
    dataset_version: int | None = Field(default=None, ge=1)
    format: Literal["masks", "coco"] = "masks"


class PatchExportStarted(BaseModel):
    job_id: uuid.UUID


class PatchExportState(StrEnum):
    CUTTING = "cutting"
    DONE = "done"
    FAILED = "failed"


class PatchExportStatus(BaseModel):
    job_id: uuid.UUID
    state: PatchExportState


async def frozen_input(
    connection: AsyncConnection, task_id: uuid.UUID, number: int
) -> dict[str, Any]:
    row = await version_row(connection, task_id, number)
    return {
        "dataset_version": row.number,
        "dataset_key": row.object_key,
        "dataset_sha256": row.sha256,
    }


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
    if not whole:
        raise DatasetHiddenError
    if not await signed_off_slides(connection, task):
        raise NothingSignedOffError
    if task.kind == TaskKind.REVIEW:
        await current_layers(connection, task)
    frozen = (
        {}
        if body.dataset_version is None
        else await frozen_input(connection, task_id, body.dataset_version)
    )
    job_id = await enqueue(
        connection,
        PATCH_PLAN,
        task.tenant_id,
        task.project_id,
        {
            "task_id": str(task_id),
            "level": body.level,
            "tile_size": body.tile_size,
            "format": body.format,
            **frozen,
        },
    )
    return PatchExportStarted(job_id=job_id)


async def job_status(connection: AsyncConnection, task_id: uuid.UUID, job_id: uuid.UUID) -> str:
    status = await connection.scalar(
        select(jobs.c.status).where(
            jobs.c.id == job_id,
            jobs.c.kind == PATCH_KIND,
            jobs.c.input["task_id"].astext == str(task_id),
        )
    )
    if status is None:
        raise NotFoundError("Patch export not found")
    return str(status)


def state_of(status: str) -> PatchExportState:
    if status in {JobStatus.FAILED, JobStatus.CANCELLED}:
        return PatchExportState.FAILED
    if status == JobStatus.DONE:
        return PatchExportState.DONE
    return PatchExportState.CUTTING


@router.get(
    "/{job_id}/status",
    operation_id="getPatchExportStatus",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_patch_export_status(
    task_id: uuid.UUID,
    job_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PatchExportStatus:
    _, whole = await readable_task(connection, principal, task_id)
    if not whole:
        raise DatasetHiddenError
    state = state_of(await job_status(connection, task_id, job_id))
    return PatchExportStatus(job_id=job_id, state=state)


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
    if not whole:
        raise DatasetHiddenError
    state = state_of(await job_status(connection, task_id, job_id))
    if state is PatchExportState.FAILED:
        raise PatchExportFailedError
    if state is PatchExportState.CUTTING:
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
