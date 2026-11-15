import base64
import binascii
import math
import struct
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import author_of, drawable_slide, slide_row
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import painted_map_versions, painted_maps, slides

MAGIC = b"PFPM"
FORMAT = 1
HEADER = struct.Struct("<4sHHIIII")
TILE_HEADER = struct.Struct("<HH")
MIN_CELL = 16
MAX_CELL = 4096
MAX_TILE_CELLS = 64
MAX_CONTENT = 16 * 1024 * 1024
MAX_ENCODED = math.ceil(MAX_CONTENT / 3) * 4
MAX_NAME = 80
MEDIA_TYPE = "application/vnd.parfocal.painted-map"

type MapName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME)
]
type Content = Annotated[str, StringConstraints(min_length=1, max_length=MAX_ENCODED)]


class PaintedMapDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: MapName
    content: Content


class PaintedMapSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Annotated[int, Field(ge=1)]
    content: Content
    name: MapName | None = None


class PaintedMap(BaseModel):
    id: uuid.UUID
    slide_id: uuid.UUID
    name: str
    version: int
    cell: int
    tile_cells: int
    painted_cells: int
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PaintedMapVersion(BaseModel):
    version: int
    painted_cells: int
    saved_by_user_id: uuid.UUID | None
    saved_at: datetime


class PaintedMapContent(PaintedMapVersion):
    painted_map_id: uuid.UUID
    content: str


class PaintedMapFileError(BadRequestError):
    code = "painted-map-file"
    title = "The painted map file cannot be read"


class PaintedMapSlideMismatchError(ConflictError):
    code = "painted-map-slide-mismatch"
    title = "The painted map was painted on a slide of another size"


class PaintedMapChangedError(ConflictError):
    code = "painted-map-changed"
    title = "This painted map changed since you loaded it"


class PaintedMapGridChangedError(ConflictError):
    code = "painted-map-grid-changed"
    title = "A painted map keeps its cell size, save a new map instead"


class SlideNotMeasuredError(ConflictError):
    code = "slide-not-measured"
    title = "The slide has no measured size yet, so it cannot hold a painted map"


@dataclass(frozen=True)
class PaintedFile:
    cell: int
    tile_cells: int
    width: int
    height: int
    painted_cells: int


router = APIRouter(prefix="/api/slides/{slide_id}/painted-maps", tags=["annotations"])


def tile_size(axis_cells: int, tile_cells: int, index: int) -> int:
    return min(tile_cells, axis_cells - index * tile_cells)


def read_painted_map(content: bytes) -> PaintedFile:
    if len(content) < HEADER.size:
        raise PaintedMapFileError("The file is too short")
    magic, version, tile_cells, cell, width, height, count = HEADER.unpack_from(content)
    if magic != MAGIC:
        raise PaintedMapFileError("This is not a painted map file")
    if version != FORMAT:
        raise PaintedMapFileError(f"Format {version} is not one this server reads")
    if not MIN_CELL <= cell <= MAX_CELL or not 1 <= tile_cells <= MAX_TILE_CELLS:
        raise PaintedMapFileError("The cell or tile size is out of range")
    if width == 0 or height == 0:
        raise PaintedMapFileError("The file has no slide size")
    columns = math.ceil(width / cell)
    rows = math.ceil(height / cell)
    tile_columns = math.ceil(columns / tile_cells)
    tile_rows = math.ceil(rows / tile_cells)
    offset = HEADER.size
    previous = -1
    painted = 0
    for _ in range(count):
        if offset + TILE_HEADER.size > len(content):
            raise PaintedMapFileError("The file ends inside a tile")
        column, row = TILE_HEADER.unpack_from(content, offset)
        if column >= tile_columns or row >= tile_rows:
            raise PaintedMapFileError("A tile lies outside the slide")
        order = row * tile_columns + column
        if order <= previous:
            raise PaintedMapFileError("The tiles are out of order")
        previous = order
        start = offset + TILE_HEADER.size
        end = start + tile_size(columns, tile_cells, column) * tile_size(rows, tile_cells, row)
        if end > len(content):
            raise PaintedMapFileError("The file ends inside a tile")
        painted += end - start - content.count(0, start, end)
        offset = end
    if offset != len(content):
        raise PaintedMapFileError("The file has bytes after its last tile")
    return PaintedFile(cell, tile_cells, width, height, painted)


def decoded(content: str) -> bytes:
    try:
        raw = base64.b64decode(content, validate=True)
    except binascii.Error as error:
        raise PaintedMapFileError("The content is not base64") from error
    if len(raw) > MAX_CONTENT:
        raise PaintedMapFileError("The file is too large")
    return raw


async def slide_size(connection: AsyncConnection, slide_id: uuid.UUID) -> tuple[int, int]:
    row = (
        await connection.execute(
            select(slides.c.width, slides.c.height).where(slides.c.id == slide_id)
        )
    ).one()
    if not row.width or not row.height:
        raise SlideNotMeasuredError
    return row.width, row.height


async def checked_file(
    connection: AsyncConnection, slide_id: uuid.UUID, content: str
) -> tuple[bytes, PaintedFile]:
    raw = decoded(content)
    painted = read_painted_map(raw)
    if (painted.width, painted.height) != await slide_size(connection, slide_id):
        raise PaintedMapSlideMismatchError
    return raw, painted


def painted_map_of(row: Any) -> PaintedMap:
    return PaintedMap(
        id=row.id,
        slide_id=row.slide_id,
        name=row.name,
        version=row.version,
        cell=row.cell,
        tile_cells=row.tile_cells,
        painted_cells=row.painted_cells,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def one_map(
    connection: AsyncConnection, slide_id: uuid.UUID, map_id: uuid.UUID
) -> PaintedMap:
    row = (
        await connection.execute(
            select(painted_maps).where(
                painted_maps.c.id == map_id, painted_maps.c.slide_id == slide_id
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Painted map not found")
    return painted_map_of(row)


async def record_version(
    connection: AsyncConnection,
    principal: Principal,
    map_id: uuid.UUID,
    version: int,
    raw: bytes,
    painted: PaintedFile,
) -> None:
    await connection.execute(
        insert(painted_map_versions).values(
            tenant_id=database_scope(principal).tenant_id,
            painted_map_id=map_id,
            version=version,
            content=raw,
            painted_cells=painted.painted_cells,
            saved_by_user_id=author_of(principal),
        )
    )


@router.get("", operation_id="listPaintedMaps", **require(Permission.SEE_SLIDES, emergency=True))
async def list_painted_maps(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[PaintedMap]:
    await slide_row(connection, principal, slide_id)
    rows = await connection.execute(
        select(painted_maps)
        .where(painted_maps.c.slide_id == slide_id)
        .order_by(painted_maps.c.created_at, painted_maps.c.id)
    )
    return [painted_map_of(row) for row in rows]


@router.post(
    "",
    operation_id="createPaintedMap",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_painted_map(
    slide_id: uuid.UUID,
    draft: PaintedMapDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PaintedMap:
    slide = await drawable_slide(connection, principal, slide_id)
    raw, painted = await checked_file(connection, slide_id, draft.content)
    map_id = await connection.scalar(
        insert(painted_maps)
        .values(
            tenant_id=database_scope(principal).tenant_id,
            project_id=slide.project_id,
            slide_id=slide_id,
            name=draft.name,
            cell=painted.cell,
            tile_cells=painted.tile_cells,
            painted_cells=painted.painted_cells,
            created_by_user_id=author_of(principal),
        )
        .returning(painted_maps.c.id)
    )
    assert map_id is not None
    await record_version(connection, principal, map_id, 1, raw, painted)
    return await one_map(connection, slide_id, map_id)


@router.put(
    "/{painted_map_id}",
    operation_id="savePaintedMap",
    **require(Permission.REVIEW, write=True),
)
async def save_painted_map(
    slide_id: uuid.UUID,
    painted_map_id: uuid.UUID,
    save: PaintedMapSave,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PaintedMap:
    await drawable_slide(connection, principal, slide_id)
    current = await one_map(connection, slide_id, painted_map_id)
    raw, painted = await checked_file(connection, slide_id, save.content)
    if (painted.cell, painted.tile_cells) != (current.cell, current.tile_cells):
        raise PaintedMapGridChangedError
    values: dict[str, Any] = {
        "version": painted_maps.c.version + 1,
        "painted_cells": painted.painted_cells,
    }
    if save.name is not None:
        values["name"] = save.name
    version = await connection.scalar(
        update(painted_maps)
        .where(
            painted_maps.c.id == painted_map_id,
            painted_maps.c.slide_id == slide_id,
            painted_maps.c.version == save.version,
        )
        .values(**values)
        .returning(painted_maps.c.version)
    )
    if version is None:
        raise PaintedMapChangedError(f"It is at version {current.version}")
    await record_version(connection, principal, painted_map_id, version, raw, painted)
    return await one_map(connection, slide_id, painted_map_id)


@router.get(
    "/{painted_map_id}/versions",
    operation_id="listPaintedMapVersions",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_painted_map_versions(
    slide_id: uuid.UUID,
    painted_map_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[PaintedMapVersion]:
    await slide_row(connection, principal, slide_id)
    await one_map(connection, slide_id, painted_map_id)
    rows = await connection.execute(
        select(
            painted_map_versions.c.version,
            painted_map_versions.c.painted_cells,
            painted_map_versions.c.saved_by_user_id,
            painted_map_versions.c.saved_at,
        )
        .where(painted_map_versions.c.painted_map_id == painted_map_id)
        .order_by(painted_map_versions.c.version)
    )
    return [
        PaintedMapVersion(
            version=row.version,
            painted_cells=row.painted_cells,
            saved_by_user_id=row.saved_by_user_id,
            saved_at=row.saved_at,
        )
        for row in rows
    ]


async def stored_version(
    connection: AsyncConnection,
    principal: Principal,
    slide_id: uuid.UUID,
    painted_map_id: uuid.UUID,
    version: int,
) -> Any:
    await slide_row(connection, principal, slide_id)
    await one_map(connection, slide_id, painted_map_id)
    row = (
        await connection.execute(
            select(painted_map_versions).where(
                painted_map_versions.c.painted_map_id == painted_map_id,
                painted_map_versions.c.version == version,
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Painted map version not found")
    return row


@router.get(
    "/{painted_map_id}/versions/{version}",
    operation_id="getPaintedMapVersion",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_painted_map_version(
    slide_id: uuid.UUID,
    painted_map_id: uuid.UUID,
    version: int,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PaintedMapContent:
    row = await stored_version(connection, principal, slide_id, painted_map_id, version)
    return PaintedMapContent(
        painted_map_id=painted_map_id,
        version=row.version,
        painted_cells=row.painted_cells,
        saved_by_user_id=row.saved_by_user_id,
        saved_at=row.saved_at,
        content=base64.b64encode(row.content).decode(),
    )


@router.get(
    "/{painted_map_id}/versions/{version}/file",
    operation_id="exportPaintedMap",
    response_class=Response,
    responses={200: {"content": {MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}}}},
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def export_painted_map(
    slide_id: uuid.UUID,
    painted_map_id: uuid.UUID,
    version: int,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    row = await stored_version(connection, principal, slide_id, painted_map_id, version)
    file_name = f"painted-map-{painted_map_id}-v{version}.pfmap"
    return Response(
        content=bytes(row.content),
        media_type=MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
