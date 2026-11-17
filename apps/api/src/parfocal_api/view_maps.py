import logging
import time
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from starlette.concurrency import run_in_threadpool

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.gpu_warm import warm_gate_of
from parfocal_api.hidden_models import refuse_hidden
from parfocal_api.model_runs import ModelOfflineError
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.view_maps import (
    MODEL,
    MODEL_VERSION,
    ViewTile,
    cells_in,
    seconds_in,
    tile_grid,
    tile_size,
)
from parfocal_common.warm_gate import WarmGate

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


async def scored_tile(gate: WarmGate, tile: ViewTile, width: int, height: int) -> ScoredTile:
    started = time.perf_counter()
    try:
        reply = await run_in_threadpool(gate.request, tile.call())
    except Exception as error:
        logger.warning("view map call failed: %s", type(error).__name__)
        raise ModelOfflineError(f"{MODEL} has no interactive worker answering") from error
    waited = time.perf_counter() - started
    cells = cells_in(reply, width, height)
    if cells is None:
        raise ModelOfflineError(f"{MODEL} has no interactive worker answering")
    reported = seconds_in(reply)
    return ScoredTile(cells, round(waited if reported is None else reported, 3))


@router.post(
    "/{column}/{row}",
    operation_id="scoreViewMapTile",
    response_class=Response,
    responses={200: {"content": {VIEW_MAP_CONTENT_TYPE: {}}}},
    **require(Permission.SEE_SLIDES, write=True),
)
async def score_view_map_tile(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    gate: Annotated[WarmGate, Depends(warm_gate_of)],
    column: int = Path(ge=0, le=100_000),
    row: int = Path(ge=0, le=100_000),
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
    tile = ViewTile(slide.tenant_id, slide_id, column, row)
    scored = await scored_tile(gate, tile, width, height)
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
        },
    )
    return Response(scored.cells, media_type=VIEW_MAP_CONTENT_TYPE, headers=VIEW_MAP_HEADERS)
