import json
import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import ai_hidden_on, require_seeing_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.review_objects import ai_claims
from parfocal_api.review_order import Results
from parfocal_api.reviewed_layer import KINDS, ai_object, fates_of, require_known, review_slide
from parfocal_api.tables import ReviewEditChange, result_objects, review_edit_versions
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore

AI_ORIGINAL = "ai-original"

router = APIRouter(prefix="/api/review-tasks/{task_id}/slides/{slide_id}", tags=["review-tasks"])


class ReviewEditVersion(BaseModel):
    object: str
    change: Literal["ai-original"] | ReviewEditChange
    class_id: uuid.UUID | None
    class_name: str | None
    geometry: dict[str, Any] | None
    deleted: bool
    related: list[str]
    reviewer_id: uuid.UUID | None
    changed_at: datetime | None


def ring_of(outline: list[float]) -> dict[str, Any]:
    points = [[outline[i], outline[i + 1]] for i in range(0, len(outline) - 1, 2)]
    return {"type": "Polygon", "coordinates": [[*points, points[0]]]}


async def ai_original(
    connection: AsyncConnection, store: ResultStore, row: Any, found: ObjectId
) -> ReviewEditVersion | None:
    key = (found.letter, found.number)
    claim = (await ai_claims(connection, store, row.result_set_id, row.slide_id, [key])).get(key)
    if claim is None:
        return None
    geometry = ring_of(claim.outline) if claim.outline and len(claim.outline) >= 6 else None
    if found.letter is Letter.REGION:
        shape = await connection.scalar(
            select(func.ST_AsGeoJSON(result_objects.c.geometry)).where(
                result_objects.c.result_set_id == row.result_set_id,
                result_objects.c.kind == "region",
                result_objects.c.number == found.number,
            )
        )
        geometry = json.loads(shape) if shape else geometry
    return ReviewEditVersion(
        object=ObjectId(found.letter, found.number).text(ascii=True),
        change=AI_ORIGINAL,
        class_id=None,
        class_name=claim.class_name or None,
        geometry=geometry,
        deleted=False,
        related=[],
        reviewer_id=None,
        changed_at=None,
    )


@router.get(
    "/edits/{object_id}/history",
    operation_id="listReviewEditHistory",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_review_edit_history(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    reviewer_id: uuid.UUID | None = None,
) -> list[ReviewEditVersion]:
    row = await review_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    found = ai_object(object_id)
    await require_known(
        connection,
        row,
        await fates_of(connection, task_id, slide_id, reviewer, found.letter),
        found,
    )
    lineage = [found.split[:length] for length in range(len(found.split) + 1)]
    versions = await connection.execute(
        select(
            review_edit_versions.c.number,
            review_edit_versions.c.split,
            review_edit_versions.c.change,
            review_edit_versions.c.class_id,
            func.ST_AsGeoJSON(review_edit_versions.c.geometry).label("geojson"),
            review_edit_versions.c.deleted,
            review_edit_versions.c.related,
            review_edit_versions.c.user_id,
            review_edit_versions.c.changed_at,
        )
        .where(
            review_edit_versions.c.task_id == task_id,
            review_edit_versions.c.slide_id == slide_id,
            review_edit_versions.c.user_id == reviewer,
            review_edit_versions.c.kind == KINDS[found.letter],
            review_edit_versions.c.number == found.number,
            review_edit_versions.c.split.in_(lineage),
        )
        .order_by(review_edit_versions.c.sequence)
    )
    history = [
        ReviewEditVersion(
            object=ObjectId(found.letter, item.number, item.split).text(ascii=True),
            change=ReviewEditChange(item.change),
            class_id=item.class_id,
            class_name=None,
            geometry=json.loads(item.geojson) if item.geojson else None,
            deleted=item.deleted,
            related=list(item.related),
            reviewer_id=item.user_id,
            changed_at=item.changed_at,
        )
        for item in versions
    ]
    if await ai_hidden_on(connection, principal, row.project_id, slide_id):
        return history
    original = await ai_original(connection, results, row, found)
    return [original, *history] if original else history
