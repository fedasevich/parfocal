from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, func, select

from parfocal_api.context import TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import AnnotationKind, AnnotationOrigin, annotations

NUCLEI_PER_HUNDRED = 100


class CorrectionsMonth(BaseModel):
    month: datetime
    nuclei_reviewed: int
    corrections: int
    per_hundred: float


class AiCorrections(BaseModel):
    since: datetime | None
    until: datetime | None
    nuclei_reviewed: int
    corrections: int
    per_hundred: float
    months: list[CorrectionsMonth]


class CorrectionsRangeError(BadRequestError):
    code = "corrections-range-invalid"
    title = "The corrections range must end after it starts"


router = APIRouter(prefix="/api/tenant", tags=["tenant"])


def per_hundred(corrections: int, reviewed: int) -> float:
    if reviewed == 0:
        return 0.0
    return round(corrections * NUCLEI_PER_HUNDRED / reviewed, 2)


def reviewed_nuclei(since: datetime | None, until: datetime | None) -> ColumnElement[bool]:
    conditions: list[ColumnElement[bool]] = [
        annotations.c.kind == AnnotationKind.CELL.value,
        annotations.c.source_number.is_not(None),
        annotations.c.origin != AnnotationOrigin.HUMAN.value,
        ~and_(
            annotations.c.origin == AnnotationOrigin.AI_CONFIRMED.value,
            annotations.c.deleted_at.is_not(None),
        ),
    ]
    if since is not None:
        conditions.append(annotations.c.created_at >= since)
    if until is not None:
        conditions.append(annotations.c.created_at < until)
    return and_(*conditions)


@router.get(
    "/ai-corrections", operation_id="getAiCorrections", **require(Permission.WORKSPACE_SETTINGS)
)
async def get_ai_corrections(
    connection: TenantConnection,
    since: datetime | None = None,
    until: datetime | None = None,
) -> AiCorrections:
    if since is not None and until is not None and until <= since:
        raise CorrectionsRangeError()
    month = func.date_trunc("month", annotations.c.created_at).label("month")
    reviewed = func.count().label("reviewed")
    corrected = func.count(
        case((annotations.c.origin == AnnotationOrigin.AI_EDITED.value, 1))
    ).label("corrected")
    rows = await connection.execute(
        select(month, reviewed, corrected)
        .where(reviewed_nuclei(since, until))
        .group_by(month)
        .order_by(month)
    )
    months = [
        CorrectionsMonth(
            month=row.month,
            nuclei_reviewed=row.reviewed,
            corrections=row.corrected,
            per_hundred=per_hundred(row.corrected, row.reviewed),
        )
        for row in rows
    ]
    total_reviewed = sum(item.nuclei_reviewed for item in months)
    total_corrections = sum(item.corrections for item in months)
    return AiCorrections(
        since=since,
        until=until,
        nuclei_reviewed=total_reviewed,
        corrections=total_corrections,
        per_hundred=per_hundred(total_corrections, total_reviewed),
        months=months,
    )
