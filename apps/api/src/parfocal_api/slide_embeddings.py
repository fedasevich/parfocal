import base64
import uuid

from fastapi import APIRouter, Path, Response
from pydantic import BaseModel

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
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
from parfocal_common.object_store import StorageError

EMBEDDING_HEADERS = {"Cache-Control": "private, max-age=3600"}


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
