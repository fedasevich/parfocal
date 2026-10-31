import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import COLUMNS as ANNOTATION_COLUMNS
from parfocal_api.annotations import Annotation, annotation_of
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import require_seeing_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.opinions import opinion_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.reviewed_layer import assigned_slide, task_slide
from parfocal_api.tables import (
    AnnotationKind,
    annotations,
    review_assignments,
    review_tasks,
)


class FirstRead(BaseModel):
    reviewer_id: uuid.UUID
    recorded_at: datetime
    form_version: int
    answers: dict[str, Any]
    added: list[Annotation]


class NoFirstReadError(ConflictError):
    code = "no-first-read"
    title = "This task shows the AI from the start, so it has no first read"


class FirstReadRecordedError(ConflictError):
    code = "first-read-recorded"
    title = "Your first read of this slide is already recorded"


class AlreadySubmittedError(ConflictError):
    code = "already-submitted"
    title = "This slide is already submitted"


class FirstReadMissingError(NotFoundError):
    code = "first-read-missing"
    title = "No first read is recorded for this reviewer on this slide"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/first-read", tags=["review-tasks"]
)


def mine(task_id: uuid.UUID, slide_id: uuid.UUID, user_id: uuid.UUID | None) -> list[Any]:
    return [
        review_assignments.c.task_id == task_id,
        review_assignments.c.slide_id == slide_id,
        review_assignments.c.user_id == user_id,
    ]


def first_read_of(reviewer: uuid.UUID, recorded_at: datetime, stored: Any) -> FirstRead:
    return FirstRead(
        reviewer_id=reviewer,
        recorded_at=recorded_at,
        form_version=stored["form_version"],
        answers=stored["answers"],
        added=[Annotation.model_validate(item) for item in stored["added"]],
    )


async def added_by(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, user_id: uuid.UUID
) -> list[Annotation]:
    return [
        annotation_of(row)
        for row in await connection.execute(
            select(*ANNOTATION_COLUMNS)
            .where(
                annotations.c.task_id == task_id,
                annotations.c.slide_id == slide_id,
                annotations.c.created_by_user_id == user_id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_([AnnotationKind.REGION, AnnotationKind.CELL]),
            )
            .order_by(annotations.c.kind, annotations.c.number)
        )
    ]


async def stored_first_read(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, reviewer: uuid.UUID
) -> FirstRead:
    row = (
        await connection.execute(
            select(review_assignments.c.first_read_at, review_assignments.c.first_read).where(
                *mine(task_id, slide_id, reviewer)
            )
        )
    ).one_or_none()
    if row is None or row.first_read_at is None:
        raise FirstReadMissingError
    return first_read_of(reviewer, row.first_read_at, row.first_read)


@router.post("", operation_id="submitFirstRead", **require(Permission.REVIEW, write=True))
async def submit_first_read(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> FirstRead:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    me = user_of(principal)
    assert me is not None
    hides = await connection.scalar(
        select(review_tasks.c.ai_hidden_first_read).where(review_tasks.c.id == task_id)
    )
    if not hides:
        raise NoFirstReadError
    assignment = (
        await connection.execute(
            select(review_assignments.c.first_read_at, review_assignments.c.submitted_at)
            .where(*mine(task_id, slide_id, me))
            .with_for_update()
        )
    ).one()
    if assignment.first_read_at is not None:
        raise FirstReadRecordedError
    if assignment.submitted_at is not None:
        raise AlreadySubmittedError
    opinion = await opinion_of(connection, task_id, slide_id, me)
    added = await added_by(connection, task_id, slide_id, me)
    snapshot = {
        "form_version": opinion.form_version,
        "answers": opinion.answers,
        "added": [item.model_dump(mode="json") for item in added],
    }
    recorded_at = (
        await connection.execute(
            update(review_assignments)
            .where(*mine(task_id, slide_id, me))
            .values(first_read_at=func.now(), first_read=snapshot)
            .returning(review_assignments.c.first_read_at)
        )
    ).scalar_one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.TASK_FIRST_READ_SUBMITTED,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=row.tenant_id,
        details={
            "slide_id": str(slide_id),
            "questions": sorted(opinion.answers),
            "added": len(added),
        },
    )
    return first_read_of(me, recorded_at, snapshot)


@router.get("", operation_id="getFirstRead", **require(Permission.SEE_SLIDES, emergency=True))
async def get_first_read(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> FirstRead:
    row = await task_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    return await stored_first_read(connection, task_id, slide_id, reviewer)
