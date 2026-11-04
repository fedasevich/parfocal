import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.result_sets import slide_row
from parfocal_api.tables import (
    ResultObjectKind,
    ResultStatus,
    result_objects,
    result_sets,
    slides,
)
from parfocal_common.object_ids import Letter, ObjectId

MICRONS_PER_MM = 1000


class SlideArea(BaseModel):
    object: str
    number: int
    result_set_id: uuid.UUID
    x: float
    y: float
    width: float
    height: float
    size_mm: float | None


router = APIRouter(prefix="/api/slides/{slide_id}/areas", tags=["slides"])


def size_of(width: float, height: float, mpp: float | None) -> float | None:
    if mpp is None or mpp <= 0:
        return None
    return round(max(width, height) * mpp / MICRONS_PER_MM, 4)


@router.get("", operation_id="listSlideAreas", **require(Permission.SEE_SLIDES, emergency=True))
async def list_slide_areas(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[SlideArea]:
    slide = await slide_row(connection, principal, slide_id)
    if await ai_hidden_on(connection, principal, slide.project_id, slide_id):
        return []
    set_id = await connection.scalar(
        select(result_sets.c.id)
        .where(
            result_sets.c.slide_id == slide_id,
            result_sets.c.deleted_at.is_(None),
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.region_count > 0,
        )
        .order_by(result_sets.c.created_at.desc(), result_sets.c.id)
        .limit(1)
    )
    if set_id is None:
        return []
    mpp = await connection.scalar(select(slides.c.mpp_x).where(slides.c.id == slide_id))
    geometry = result_objects.c.geometry
    rows = await connection.execute(
        select(
            result_objects.c.number,
            func.ST_XMin(geometry).label("x_min"),
            func.ST_YMin(geometry).label("y_min"),
            func.ST_XMax(geometry).label("x_max"),
            func.ST_YMax(geometry).label("y_max"),
        )
        .where(
            result_objects.c.result_set_id == set_id,
            result_objects.c.kind == ResultObjectKind.REGION,
        )
        .order_by(result_objects.c.number)
    )
    areas: list[SlideArea] = []
    for row in rows:
        width = row.x_max - row.x_min
        height = row.y_max - row.y_min
        areas.append(
            SlideArea(
                object=ObjectId(Letter.REGION, row.number).text(ascii=True),
                number=row.number,
                result_set_id=set_id,
                x=row.x_min,
                y=row.y_min,
                width=width,
                height=height,
                size_mm=size_of(width, height, mpp),
            )
        )
    return areas
