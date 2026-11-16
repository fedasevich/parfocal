import uuid
from types import SimpleNamespace
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.hidden_models import refuse_hidden
from parfocal_api.model_catalogue import BY_NAME
from parfocal_api.model_runs import (
    ModelOfflineError,
    SlideNotInProjectError,
    require_controlling,
    started_by,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import NotFoundError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.projects import visible
from parfocal_api.result_sets import ResultSetDraft, insert_result_set
from parfocal_api.tables import PrivacyMode, ResultSource, jobs, projects, slides
from parfocal_api.worker_serving import Serving, WorkerProbe, probe_of, serving_of
from parfocal_common.jobs import JobStatus
from parfocal_common.tumor_maps import (
    MODEL,
    MODEL_VERSION,
    TumorMapInput,
    enqueue_tumor_map,
    input_of,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


class TumorMapJob(BaseModel):
    job_id: uuid.UUID
    result_set_id: uuid.UUID
    slide_id: uuid.UUID
    status: JobStatus


class TumorMapNotFoundError(NotFoundError):
    code = "tumor-map-not-found"
    title = "Tumor map not found"


def result_set_draft() -> ResultSetDraft:
    title = BY_NAME[MODEL].title
    return ResultSetDraft(name=f"{title} {MODEL_VERSION} map", model_version=MODEL_VERSION)


async def slide_in(connection: AsyncConnection, project_id: uuid.UUID, slide_id: uuid.UUID) -> None:
    found = await connection.scalar(
        select(slides.c.id).where(
            slides.c.id == slide_id,
            slides.c.project_id == project_id,
            slides.c.deleted_at.is_(None),
        )
    )
    if found is None:
        raise SlideNotInProjectError


@router.post(
    "/{project_id}/slides/{slide_id}/tumor-maps",
    status_code=201,
    operation_id="startTumorMap",
    **require(Permission.RUN_MODELS, write=True),
)
async def start_tumor_map(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    probe: Annotated[WorkerProbe, Depends(probe_of)],
) -> TumorMapJob:
    project = await visible(connection, principal, project_id)
    await require_controlling(connection, principal, project_id, project.archived_at is not None)
    await slide_in(connection, project_id, slide_id)
    await refuse_hidden(connection, {MODEL})
    if serving_of(probe, MODEL) is Serving.OFFLINE:
        raise ModelOfflineError(f"{MODEL} has no worker answering right now")
    set_id = uuid.uuid4()
    job_input = TumorMapInput(slide_id, set_id)
    job_id = await enqueue_tumor_map(connection, project.tenant_id, project_id, job_input)
    actor = actor_of(principal)
    await insert_result_set(
        connection,
        project.tenant_id,
        SimpleNamespace(id=slide_id, project_id=project_id),
        result_set_draft(),
        ResultSource.RUN,
        actor,
        started_by(principal),
        job_id,
        set_id,
    )
    await record(
        connection,
        actor,
        AuditAction.TUMOR_MAP_STARTED,
        AuditTarget.RESULT_SET,
        set_id,
        tenant_id=project.tenant_id,
        details={
            "project_id": str(project_id),
            "slide_id": str(slide_id),
            "job_id": str(job_id),
            "model": f"{MODEL}@{MODEL_VERSION}",
        },
    )
    return TumorMapJob(
        job_id=job_id, result_set_id=set_id, slide_id=slide_id, status=JobStatus.QUEUED
    )


async def require_map_reading(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, job_id: uuid.UUID
) -> None:
    row = (
        await connection.execute(
            select(jobs.c.input, projects.c.privacy_mode)
            .join(projects, projects.c.id == jobs.c.project_id)
            .where(jobs.c.id == job_id, jobs.c.project_id == project_id)
        )
    ).one_or_none()
    if row is None:
        raise TumorMapNotFoundError
    slide_id = input_of(row.input).slide_id
    await require_slide_reading(
        connection,
        principal,
        project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        TumorMapNotFoundError.title,
    )
    if await ai_hidden_on(connection, principal, project_id, slide_id):
        raise TumorMapNotFoundError
