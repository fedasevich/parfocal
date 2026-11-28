import math
import uuid
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.model_catalogue import (
    BY_NAME,
    L4_DOLLARS_PER_SECOND,
    CatalogueModel,
    throughput,
)
from parfocal_api.model_registry import PATHOSAM_MPP
from parfocal_api.model_runs import ModelNotFoundError, SlideNotInProjectError, measured_seconds
from parfocal_api.permissions import Permission, require
from parfocal_api.projects import visible
from parfocal_api.slide_coverage import BASE_CELL, readable_slide
from parfocal_api.slide_tissue import MaskImage, TissueMaskUnreadableError, read_mask
from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import StorageError

MAX_SLIDES = 200
SQUARE_MICRONS_PER_SQUARE_MM = 1_000_000
ASSUMED_MPP = PATHOSAM_MPP


class EstimateGap(StrEnum):
    NO_RATE = "no-rate"
    NO_TISSUE_MASK = "no-tissue-mask"


class SlideEstimate(BaseModel):
    slide_id: uuid.UUID
    tissue_mm2: float | None
    minutes: int | None
    dollars: float | None
    projected: bool
    assumed_mpp: float | None = None
    unknown_because: EstimateGap | None = None


router = APIRouter(prefix="/api/projects", tags=["model-runs"])


async def stored_mask(store: Store, row: Any, slide_id: uuid.UUID) -> MaskImage | None:
    key = f"{slide_prefix(row.tenant_id, slide_id)}tissue.png"
    try:
        stored = await store.get_object(key)
    except StorageError as error:
        if error.status != 404:
            raise
        return None
    try:
        return read_mask(stored)
    except TissueMaskUnreadableError, ValueError, IndexError:
        return None


def tissue_mm2(mask: MaskImage, mpp_x: float, mpp_y: float) -> float:
    cells = sum(1 for row in mask.cells for value in row if value != 0)
    microns = cells * BASE_CELL * mpp_x * BASE_CELL * mpp_y
    return microns / SQUARE_MICRONS_PER_SQUARE_MM


def unknown(slide_id: uuid.UUID, because: EstimateGap) -> SlideEstimate:
    return SlideEstimate(
        slide_id=slide_id,
        tissue_mm2=None,
        minutes=None,
        dollars=None,
        projected=True,
        unknown_because=because,
    )


def scale_of(row: Any) -> tuple[float, float, float | None]:
    if row.mpp_x and row.mpp_y:
        return row.mpp_x, row.mpp_y, None
    return ASSUMED_MPP, ASSUMED_MPP, ASSUMED_MPP


def estimate_of(
    slide_id: uuid.UUID,
    model: CatalogueModel,
    mask: MaskImage | None,
    row: Any,
    measured_minutes: int | None,
) -> SlideEstimate:
    rate = model.projected_seconds_per_mm2
    if rate is None:
        return unknown(slide_id, EstimateGap.NO_RATE)
    if mask is None:
        return unknown(slide_id, EstimateGap.NO_TISSUE_MASK)
    mpp_x, mpp_y, assumed = scale_of(row)
    area = tissue_mm2(mask, mpp_x, mpp_y)
    seconds = rate * area if measured_minutes is None else measured_minutes * 60
    return SlideEstimate(
        slide_id=slide_id,
        tissue_mm2=round(area, 2),
        minutes=max(1, math.ceil(seconds / 60)),
        dollars=round(seconds * L4_DOLLARS_PER_SECOND, 4),
        projected=measured_minutes is None,
        assumed_mpp=assumed,
    )


async def measured_minutes(connection: AsyncConnection, model: CatalogueModel) -> int | None:
    rate = throughput(await measured_seconds(connection, model), model.nominal_minutes)
    return rate.minutes_per_slide if rate.measured else None


@router.get(
    "/{project_id}/models/{model_name}/estimates",
    operation_id="estimateModelRun",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def estimate_model_run(
    project_id: uuid.UUID,
    model_name: str,
    slide_ids: Annotated[list[uuid.UUID], Query(alias="slide_id", max_length=MAX_SLIDES)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> list[SlideEstimate]:
    await visible(connection, principal, project_id)
    model = BY_NAME.get(model_name)
    if model is None:
        raise ModelNotFoundError(f"{model_name!r} is not a Parfocal model")
    measured = await measured_minutes(connection, model)
    found: list[SlideEstimate] = []
    for slide_id in slide_ids:
        row = await readable_slide(connection, principal, slide_id)
        if row.project_id != project_id:
            raise SlideNotInProjectError
        mask = (
            await stored_mask(store, row, slide_id)
            if model.projected_seconds_per_mm2 is not None
            else None
        )
        found.append(estimate_of(slide_id, model, mask, row, measured))
    return found
