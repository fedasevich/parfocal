import base64
import math
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.tables import PrivacyMode, projects, slide_coverage, slides

BASE_CELL = 64
MAX_SIDE = 1024
MAX_BATCH = 8192


class CoverageGrid(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cell: Annotated[int, Field(ge=1)]
    columns: Annotated[int, Field(ge=1, le=MAX_SIDE)]
    rows: Annotated[int, Field(ge=1, le=MAX_SIDE)]


class SlideCoverage(BaseModel):
    slide_id: uuid.UUID
    grid: CoverageGrid
    seen: str
    seen_cells: int
    updated_at: datetime | None


class CoverageBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grid: CoverageGrid
    cells: Annotated[list[Annotated[int, Field(ge=0)]], Field(min_length=1, max_length=MAX_BATCH)]


class SlideNotMeasuredError(ConflictError):
    code = "slide-not-measured"
    title = "The slide has no measured size yet, so coverage has no grid"


class CoverageGridMismatchError(ConflictError):
    code = "coverage-grid-mismatch"
    title = "The coverage grid does not match this slide"


class CoverageCellOutsideError(BadRequestError):
    code = "coverage-cell-outside"
    title = "A coverage cell lies outside the slide's grid"


router = APIRouter(prefix="/api/slides/{slide_id}/coverage", tags=["slides"])


def grid_for(width: int, height: int) -> CoverageGrid:
    longest = max(1, width, height)
    cell = BASE_CELL
    while math.ceil(longest / cell) > MAX_SIDE:
        cell *= 2
    return CoverageGrid(
        cell=cell,
        columns=max(1, math.ceil(width / cell)),
        rows=max(1, math.ceil(height / cell)),
    )


def bitset_bytes(grid: CoverageGrid) -> int:
    return math.ceil(grid.columns * grid.rows / 8)


def seen_count(bits: bytes) -> int:
    return int.from_bytes(bits, "little").bit_count()


def coverage_of(
    slide_id: uuid.UUID, grid: CoverageGrid, bits: bytes, updated_at: datetime | None
) -> SlideCoverage:
    return SlideCoverage(
        slide_id=slide_id,
        grid=grid,
        seen=base64.b64encode(bits).decode(),
        seen_cells=seen_count(bits),
        updated_at=updated_at,
    )


def me_of(principal: Principal) -> uuid.UUID:
    me = user_of(principal)
    if me is None:
        raise NotFoundError("Only a person has slide coverage")
    return me


async def readable_slide(
    connection: AsyncConnection, principal: Principal, slide_id: uuid.UUID
) -> Any:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id,
                slides.c.project_id,
                slides.c.width,
                slides.c.height,
                projects.c.privacy_mode,
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Slide not found",
    )
    return row


def slide_grid(row: Any) -> CoverageGrid:
    if not row.width or not row.height:
        raise SlideNotMeasuredError
    return grid_for(row.width, row.height)


def stored_bits(stored: Any, grid: CoverageGrid) -> bytearray:
    if stored is None or (stored.cell, stored.columns, stored.rows) != (
        grid.cell,
        grid.columns,
        grid.rows,
    ):
        return bytearray(bitset_bytes(grid))
    return bytearray(stored.seen)


@router.get("", operation_id="getSlideCoverage", **require(Permission.SEE_SLIDES))
async def get_slide_coverage(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> SlideCoverage:
    me = me_of(principal)
    grid = slide_grid(await readable_slide(connection, principal, slide_id))
    stored = (
        await connection.execute(
            select(slide_coverage).where(
                slide_coverage.c.slide_id == slide_id, slide_coverage.c.user_id == me
            )
        )
    ).one_or_none()
    return coverage_of(
        slide_id,
        grid,
        bytes(stored_bits(stored, grid)),
        None if stored is None else stored.updated_at,
    )


@router.post("", operation_id="recordSlideCoverage", **require(Permission.SEE_SLIDES, write=True))
async def record_slide_coverage(
    slide_id: uuid.UUID,
    batch: CoverageBatch,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SlideCoverage:
    me = me_of(principal)
    row = await readable_slide(connection, principal, slide_id)
    grid = slide_grid(row)
    if batch.grid != grid:
        raise CoverageGridMismatchError
    total = grid.columns * grid.rows
    if any(cell >= total for cell in batch.cells):
        raise CoverageCellOutsideError
    await connection.execute(
        upsert(slide_coverage)
        .values(
            tenant_id=row.tenant_id,
            slide_id=slide_id,
            user_id=me,
            cell=grid.cell,
            columns=grid.columns,
            rows=grid.rows,
            seen=bytes(bitset_bytes(grid)),
            seen_cells=0,
        )
        .on_conflict_do_nothing(
            index_elements=[slide_coverage.c.slide_id, slide_coverage.c.user_id]
        )
    )
    mine = [slide_coverage.c.slide_id == slide_id, slide_coverage.c.user_id == me]
    stored = (await connection.execute(select(slide_coverage).where(*mine).with_for_update())).one()
    bits = stored_bits(stored, grid)
    for cell in batch.cells:
        bits[cell >> 3] |= 1 << (cell & 7)
    updated_at = (
        await connection.execute(
            update(slide_coverage)
            .where(*mine)
            .values(
                cell=grid.cell,
                columns=grid.columns,
                rows=grid.rows,
                seen=bytes(bits),
                seen_cells=seen_count(bytes(bits)),
            )
            .returning(slide_coverage.c.updated_at)
        )
    ).scalar_one()
    return coverage_of(slide_id, grid, bytes(bits), updated_at)
