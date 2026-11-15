import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Response
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_runs import readable_run
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.review_order import Results
from parfocal_api.tables import job_steps, job_units
from parfocal_common.jobs import JobStatus
from parfocal_common.model_runs import MODEL_STAGE, run_prefix, tile_key
from parfocal_common.result_store import MissingObjectError

MAX_AREAS = 1000
MAX_TILE = 999_999
CELL_CHUNK_TYPE = "application/vnd.parfocal.cells"


class RunArea(BaseModel):
    seq: int
    stage: str
    unit: int
    x: int
    y: int
    width: int
    height: int
    objects: int
    done_at: datetime


class RunAreas(BaseModel):
    run_id: uuid.UUID
    status: JobStatus
    areas: list[RunArea]
    after: int
    more: bool
    total: int | None = None


class TileNotFinishedError(NotFoundError):
    code = "tile-not-finished"
    title = "This tile of the run has not finished"


TILE_RESPONSE: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "The finished tile's cell chunk, sent gzip-encoded",
        "content": {CELL_CHUNK_TYPE: {"schema": {"type": "string", "format": "binary"}}},
    }
}

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def model_stage_total(connection: Any, run_id: uuid.UUID) -> int | None:
    total = await connection.scalar(
        select(job_steps.c.units_total).where(
            job_steps.c.job_id == run_id, job_steps.c.name == MODEL_STAGE
        )
    )
    return None if total is None else int(total)


@router.get(
    "/{project_id}/model-runs/{run_id}/areas",
    operation_id="listModelRunAreas",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_model_run_areas(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    after: Annotated[int, Query(ge=0)] = 0,
) -> RunAreas:
    run = await readable_run(connection, principal, project_id, run_id)
    rows = (
        await connection.execute(
            select(job_units, job_steps.c.name.label("stage"))
            .join(
                job_steps,
                (job_steps.c.job_id == job_units.c.job_id)
                & (job_steps.c.ordinal == job_units.c.ordinal),
            )
            .where(
                job_units.c.job_id == run_id,
                job_units.c.seq > after,
                job_units.c.result.is_not(None),
            )
            .order_by(job_units.c.seq)
            .limit(MAX_AREAS + 1)
        )
    ).all()
    areas = [
        RunArea(
            seq=row.seq,
            stage=row.stage,
            unit=row.unit,
            x=row.result["x"],
            y=row.result["y"],
            width=row.result["width"],
            height=row.result["height"],
            objects=row.result["objects"],
            done_at=row.done_at,
        )
        for row in rows[:MAX_AREAS]
    ]
    return RunAreas(
        run_id=run_id,
        status=JobStatus(run.status),
        areas=areas,
        after=areas[-1].seq if areas else after,
        more=len(rows) > MAX_AREAS,
        total=await model_stage_total(connection, run_id),
    )


@router.get(
    "/{project_id}/model-runs/{run_id}/tiles/{unit}",
    operation_id="getModelRunTile",
    response_class=Response,
    responses=TILE_RESPONSE,
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_model_run_tile(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    unit: Annotated[int, Path(ge=0, le=MAX_TILE)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> Response:
    run = await readable_run(connection, principal, project_id, run_id)
    finished = await connection.scalar(
        select(job_units.c.seq)
        .join(
            job_steps,
            (job_steps.c.job_id == job_units.c.job_id)
            & (job_steps.c.ordinal == job_units.c.ordinal),
        )
        .where(
            job_units.c.job_id == run_id,
            job_units.c.unit == unit,
            job_steps.c.name == MODEL_STAGE,
            job_units.c.result.is_not(None),
        )
    )
    if finished is None:
        raise TileNotFinishedError
    key = tile_key(run_prefix(run.tenant_id, run.slide_id, run_id), unit)
    try:
        body = await results.get_packed(key)
    except MissingObjectError as error:
        raise TileNotFinishedError from error
    return Response(
        body,
        media_type=CELL_CHUNK_TYPE,
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{run_id}-{unit}-{finished}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
