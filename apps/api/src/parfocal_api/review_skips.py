import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as upsert

from parfocal_api.audit import AuditAction
from parfocal_api.blinding import require_judging_allowed, require_seeing_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError, ConflictError
from parfocal_api.reviewed_layer import KINDS, ai_object, assigned_slide, check_exists, review_slide
from parfocal_api.tables import AnnotationKind, review_skips, verdicts
from parfocal_api.verdicts import (
    REPORTED_CALL,
    Score,
    ai_call,
    ai_details,
    audit,
    lock_object,
    same_object,
)
from parfocal_common.object_ids import Letter, ObjectId


class SkipDraft(BaseModel):
    ai_class_id: uuid.UUID | None = Field(default=None, description=REPORTED_CALL)
    ai_score: Score | None = Field(default=None, description=REPORTED_CALL)


class Skip(BaseModel):
    object: str
    kind: AnnotationKind
    number: int
    ai_class_id: uuid.UUID | None = Field(description=REPORTED_CALL)
    ai_score: int | None = Field(description=REPORTED_CALL)
    updated_at: datetime


class ObjectDecidedError(ConflictError):
    code = "object-decided"
    title = "The object already has a decision. Clear it before skipping the object"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/skips", tags=["review-tasks"]
)


def skip_of(row: Any) -> Skip:
    kind = AnnotationKind(row.kind)
    letter = Letter.REGION if kind is AnnotationKind.REGION else Letter.CELL
    return Skip(
        object=ObjectId(letter, row.number).text(ascii=True),
        kind=kind,
        number=row.number,
        ai_class_id=row.ai_class_id,
        ai_score=row.ai_score,
        updated_at=row.updated_at,
    )


@router.put("/{object_id}", operation_id="skipObject", **require(Permission.REVIEW, write=True))
async def skip_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: SkipDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Skip:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    await check_exists(connection, row, found)
    me = user_of(principal)
    await lock_object(connection, task_id, slide_id, me, kind, found.number)
    decided = select(verdicts).where(
        *same_object(verdicts, task_id, slide_id, me, kind, found.number)
    )
    if await connection.scalar(select(decided.exists())):
        raise ObjectDecidedError
    ai_class_id, ai_score = await ai_call(
        connection, row, kind, found.number, draft.ai_class_id, draft.ai_score
    )
    saving = upsert(review_skips).values(
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        task_id=task_id,
        slide_id=slide_id,
        user_id=me,
        kind=kind,
        number=found.number,
        ai_class_id=ai_class_id,
        ai_score=ai_score,
    )
    await connection.execute(
        saving.on_conflict_do_update(
            index_elements=[
                review_skips.c.task_id,
                review_skips.c.slide_id,
                review_skips.c.user_id,
                review_skips.c.kind,
                review_skips.c.number,
            ],
            set_={"ai_class_id": ai_class_id, "ai_score": ai_score},
        )
    )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_SKIPPED,
        row,
        {"object": found.text(ascii=True), **ai_details(ai_class_id, ai_score)},
    )
    saved = (
        await connection.execute(
            select(review_skips).where(
                *same_object(review_skips, task_id, slide_id, me, kind, found.number)
            )
        )
    ).one()
    return skip_of(saved)


@router.delete(
    "/{object_id}",
    operation_id="clearSkip",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def clear_skip(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    me = user_of(principal)
    await lock_object(connection, task_id, slide_id, me, kind, found.number)
    cleared = (
        await connection.execute(
            delete(review_skips)
            .where(*same_object(review_skips, task_id, slide_id, me, kind, found.number))
            .returning(review_skips.c.number)
        )
    ).one_or_none()
    if cleared is not None:
        await audit(
            connection,
            principal,
            AuditAction.REVIEW_SKIP_CLEARED,
            row,
            {"object": found.text(ascii=True)},
        )
    return Response(status_code=204)


@router.get("", operation_id="listSkips", **require(Permission.SEE_SLIDES, emergency=True))
async def list_skips(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> list[Skip]:
    row = await review_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    rows = await connection.execute(
        select(review_skips)
        .where(
            review_skips.c.task_id == task_id,
            review_skips.c.slide_id == slide_id,
            review_skips.c.user_id == reviewer,
        )
        .order_by(review_skips.c.kind, review_skips.c.number)
    )
    return [skip_of(item) for item in rows]
