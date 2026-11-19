import logging
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.gpu_calls import (
    GpuCalls,
    GpuCallScope,
    GpuWaiting,
    gpu_calls_of,
    scope_of,
    waiting_response,
)
from parfocal_api.hidden_models import refuse_hidden
from parfocal_api.model_runs import ModelOfflineError
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.ingest import folder_of
from parfocal_common.view_maps import (
    MODEL,
    MODEL_VERSION,
    ViewTile,
    cells_in,
    seconds_in,
    tile_grid,
    tile_size,
)

logger = logging.getLogger("parfocal.api.view_maps")

VIEW_MAP_CONTENT_TYPE = "application/octet-stream"
VIEW_MAP_HEADERS = {"Cache-Control": "no-store"}

router = APIRouter(prefix="/api/slides/{slide_id}/view-map", tags=["slides"])


class ViewTileOutsideError(NotFoundError):
    code = "view-tile-outside"
    title = "This view tile is outside the slide"


@dataclass(frozen=True)
class ScoredTile:
    cells: bytes
    gpu_seconds: float
    waited_seconds: float


async def scored_tile(
    calls: GpuCalls,
    scope: GpuCallScope,
    tile: ViewTile,
    size: tuple[int, int],
    token: str | None,
) -> ScoredTile | GpuWaiting:
    try:
        answer = await calls.answer_or_wait(scope, tile.call(), token)
    except ProblemError:
        raise
    except Exception as error:
        logger.warning("view map call failed: %s", type(error).__name__)
        raise ModelOfflineError(f"{MODEL} has no interactive worker answering") from error
    if isinstance(answer, GpuWaiting):
        return answer
    cells = cells_in(answer.reply, *size)
    if cells is None:
        raise ModelOfflineError(f"{MODEL} has no interactive worker answering")
    reported = seconds_in(answer.reply)
    gpu_seconds = answer.waited_seconds if reported is None else round(reported, 3)
    return ScoredTile(cells, gpu_seconds, answer.waited_seconds)


@router.post(
    "/{column}/{row}",
    operation_id="scoreViewMapTile",
    response_class=Response,
    responses={200: {"content": {VIEW_MAP_CONTENT_TYPE: {}}}, 202: {"model": GpuWaiting}},
    **require(Permission.SEE_SLIDES, write=True),
)
async def score_view_map_tile(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    calls: Annotated[GpuCalls, Depends(gpu_calls_of)],
    column: int = Path(ge=0, le=100_000),
    row: int = Path(ge=0, le=100_000),
    call: str | None = Query(default=None, max_length=2048),
) -> Response:
    slide = await readable_slide(connection, principal, slide_id)
    if await ai_hidden_on(connection, principal, slide.project_id, slide_id):
        raise NotFoundError("Slide not found")
    await refuse_hidden(connection, {MODEL})
    if slide.width is None or slide.height is None:
        raise ViewTileOutsideError
    columns, rows = tile_grid(slide.width, slide.height)
    if column >= columns or row >= rows:
        raise ViewTileOutsideError
    width, height = tile_size(slide.width, slide.height, column, row)
    folder = None if slide.original_key is None else folder_of(slide.original_key)
    tile = ViewTile(slide.tenant_id, slide_id, column, row, folder)
    scope = scope_of("view-map", principal, slide.tenant_id, slide_id)
    scored = await scored_tile(calls, scope, tile, (width, height), call)
    if isinstance(scored, GpuWaiting):
        return waiting_response(scored)
    await record(
        connection,
        actor_of(principal),
        AuditAction.VIEW_MAP_SCORED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=slide.tenant_id,
        details={
            "project_id": str(slide.project_id),
            "column": column,
            "row": row,
            "model": f"{MODEL}@{MODEL_VERSION}",
            "gpu_seconds": scored.gpu_seconds,
            "waited_seconds": scored.waited_seconds,
        },
    )
    return Response(scored.cells, media_type=VIEW_MAP_CONTENT_TYPE, headers=VIEW_MAP_HEADERS)
