import base64
import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.gpu_warm import warm_for, warm_gate_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.embedding_cache import (
    EMBEDDING_BYTES,
    EMBEDDING_CONTENT_TYPE,
    EMBEDDING_DIMS,
    EMBEDDING_DTYPE,
    ManifestUnreadableError,
    manifest_key,
    read_manifest,
    tile_key,
)
from parfocal_common.ingest import folder_of
from parfocal_common.object_store import StorageError
from parfocal_common.view_embeddings import (
    ENCODER,
    ENCODER_MODEL,
    ENCODER_VERSION,
    MAX_VIEW_SIDE,
    MIN_VIEW_SIDE,
    ViewEmbeddingCall,
    embedding_in,
)
from parfocal_common.view_maps import seconds_in
from parfocal_common.warm_gate import Device, WarmGate

logger = logging.getLogger("parfocal.api.slide_embeddings")

EMBEDDING_HEADERS = {"Cache-Control": "private, max-age=3600"}
VIEW_EMBEDDING_HEADERS = {"Cache-Control": "no-store", "Parfocal-Encoder": ENCODER}
MAX_SLIDE_PIXEL = 10_000_000


class SlideEmbeddings(BaseModel):
    slide_id: uuid.UUID
    encoder: str
    dtype: str
    dims: list[int]
    level: int
    downsample: float
    tile: int
    level_width: int
    level_height: int
    columns: int
    rows: int
    tiles: str
    tile_count: int


class EmbedderWarm(BaseModel):
    device: Device


class ViewToEmbed(BaseModel):
    x: int = Field(ge=0, le=MAX_SLIDE_PIXEL)
    y: int = Field(ge=0, le=MAX_SLIDE_PIXEL)
    width: int = Field(ge=MIN_VIEW_SIDE, le=MAX_VIEW_SIDE)
    height: int = Field(ge=MIN_VIEW_SIDE, le=MAX_VIEW_SIDE)


class EncoderOfflineError(ProblemError):
    status = 503
    code = "encoder-offline"
    title = "No encoder worker is answering. Try again in a moment"


class ViewOutsideError(NotFoundError):
    code = "view-outside"
    title = "This view reaches past the slide"


class EmbeddingsMissingError(NotFoundError):
    code = "embeddings-missing"
    title = "This slide has no server embeddings yet"


class EmbeddingTileMissingError(NotFoundError):
    code = "embedding-tile-missing"
    title = "This tile has no server embedding"


router = APIRouter(prefix="/api/slides/{slide_id}/embeddings", tags=["slides"])


async def stored(store: Store, key: str, missing: NotFoundError) -> bytes:
    try:
        return await store.get_object(key)
    except StorageError as error:
        if error.status == 404:
            raise missing from error
        raise


@router.get("", operation_id="getSlideEmbeddings", **require(Permission.SEE_SLIDES))
async def get_slide_embeddings(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
    response: Response,
) -> SlideEmbeddings:
    row = await readable_slide(connection, principal, slide_id)
    data = await stored(store, manifest_key(row.tenant_id, slide_id), EmbeddingsMissingError())
    try:
        manifest = read_manifest(data)
    except ManifestUnreadableError as error:
        raise EmbeddingsMissingError from error
    response.headers.update(EMBEDDING_HEADERS)
    return SlideEmbeddings(
        slide_id=slide_id,
        encoder=manifest.encoder,
        dtype=EMBEDDING_DTYPE,
        dims=list(EMBEDDING_DIMS),
        level=manifest.level,
        downsample=manifest.downsample,
        tile=manifest.tile,
        level_width=manifest.level_width,
        level_height=manifest.level_height,
        columns=manifest.columns,
        rows=manifest.rows,
        tiles=base64.b64encode(manifest.tiles).decode(),
        tile_count=manifest.count(),
    )


@router.get(
    "/{column}/{row}",
    operation_id="getSlideEmbeddingTile",
    response_class=Response,
    responses={200: {"content": {EMBEDDING_CONTENT_TYPE: {}}}},
    **require(Permission.SEE_SLIDES),
)
async def get_slide_embedding_tile(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
    column: int = Path(ge=0, le=100_000),
    row: int = Path(ge=0, le=100_000),
) -> Response:
    slide = await readable_slide(connection, principal, slide_id)
    body = await stored(
        store, tile_key(slide.tenant_id, slide_id, column, row), EmbeddingTileMissingError()
    )
    if len(body) != EMBEDDING_BYTES:
        raise EmbeddingTileMissingError
    return Response(body, media_type=EMBEDDING_CONTENT_TYPE, headers=EMBEDDING_HEADERS)


@router.post(
    "/warm",
    operation_id="warmSlideEmbedder",
    status_code=204,
    **require(Permission.SEE_SLIDES, write=True),
)
async def warm_slide_embedder(
    slide_id: uuid.UUID,
    body: EmbedderWarm,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    gate: Annotated[WarmGate, Depends(warm_gate_of)],
) -> Response:
    await readable_slide(connection, principal, slide_id)
    await warm_for(gate, body.device)
    return Response(status_code=204)


async def embedded_view(gate: WarmGate, view: ViewEmbeddingCall) -> tuple[bytes, float]:
    started = time.perf_counter()
    try:
        reply = await run_in_threadpool(gate.request, view.call())
    except Exception as error:
        logger.warning("view embedding call failed: %s", type(error).__name__)
        raise EncoderOfflineError from error
    waited = time.perf_counter() - started
    embedding = embedding_in(reply)
    if embedding is None:
        raise EncoderOfflineError
    reported = seconds_in(reply)
    return embedding, round(waited if reported is None else reported, 3)


@router.post(
    "/view",
    operation_id="embedSlideView",
    response_class=Response,
    responses={200: {"content": {EMBEDDING_CONTENT_TYPE: {}}}},
    **require(Permission.SEE_SLIDES, write=True),
)
async def embed_slide_view(
    slide_id: uuid.UUID,
    body: ViewToEmbed,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    gate: Annotated[WarmGate, Depends(warm_gate_of)],
) -> Response:
    slide = await readable_slide(connection, principal, slide_id)
    if await ai_hidden_on(connection, principal, slide.project_id, slide_id):
        raise NotFoundError("Slide not found")
    if (
        slide.width is None
        or slide.height is None
        or body.x + body.width > slide.width
        or body.y + body.height > slide.height
    ):
        raise ViewOutsideError
    folder = None if slide.original_key is None else folder_of(slide.original_key)
    view = ViewEmbeddingCall(
        slide.tenant_id, slide_id, body.x, body.y, body.width, body.height, folder
    )
    embedding, gpu_seconds = await embedded_view(gate, view)
    await record(
        connection,
        actor_of(principal),
        AuditAction.VIEW_EMBEDDED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=slide.tenant_id,
        details={
            "project_id": str(slide.project_id),
            "encoder": f"{ENCODER_MODEL}@{ENCODER_VERSION}",
            "gpu_seconds": gpu_seconds,
        },
    )
    return Response(embedding, media_type=EMBEDDING_CONTENT_TYPE, headers=VIEW_EMBEDDING_HEADERS)
