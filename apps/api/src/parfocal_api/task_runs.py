import secrets
import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select, update

from parfocal_api.annotate_layer import editable_layer
from parfocal_api.audit import AuditAction
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.review_order import Results, store_order, stored_seeds
from parfocal_api.review_tasks import (
    NoResultSetError,
    TaskSlide,
    audit,
    by_least_sure,
    ordering_scopes,
    task_row,
)
from parfocal_api.tables import (
    ResultStatus,
    result_sets,
    review_assignments,
    review_task_slides,
)


class RunJoin(BaseModel):
    result_set_id: uuid.UUID


router = APIRouter(prefix="/api/review-tasks/{task_id}/slides/{slide_id}", tags=["review-tasks"])


@router.post("/runs", operation_id="addRunToTaskSlide", **require(Permission.REVIEW, write=True))
async def add_run_to_task_slide(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    join: RunJoin,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> TaskSlide:
    place = await editable_layer(connection, principal, task_id, slide_id)
    ready = await connection.scalar(
        select(result_sets.c.id).where(
            result_sets.c.id == join.result_set_id,
            result_sets.c.slide_id == slide_id,
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.deleted_at.is_(None),
        )
    )
    if ready is None:
        raise NoResultSetError("Add only a finished result set of the same slide")
    current = (
        await connection.execute(
            select(review_task_slides.c.result_set_id, review_task_slides.c.run_set_ids).where(
                review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id
            )
        )
    ).one()
    known = [current.result_set_id, *current.run_set_ids]
    if join.result_set_id not in known:
        values = (
            {"result_set_id": join.result_set_id}
            if current.result_set_id is None
            else {"run_set_ids": [*current.run_set_ids, join.result_set_id]}
        )
        await connection.execute(
            update(review_task_slides)
            .where(
                review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id
            )
            .values(**values)
        )
        task = await task_row(connection, task_id)
        scopes = ordering_scopes(task)
        if scopes:
            seeds = await stored_seeds(connection, task_id, [slide_id])
            await store_order(
                connection,
                results,
                place.tenant_id,
                place.project_id,
                task_id,
                scopes,
                {slide_id: [item for item in [*known, join.result_set_id] if item is not None]},
                {slide_id: seeds.get(slide_id, secrets.randbits(62))},
                by_least_sure(task),
            )
        await audit(
            connection,
            principal,
            AuditAction.TASK_CHANGED,
            place.tenant_id,
            task_id,
            {"fields": ["run_set_ids"], "slide_id": str(slide_id)},
        )
    row = (
        await connection.execute(
            select(review_task_slides.c.result_set_id, review_task_slides.c.run_set_ids).where(
                review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id
            )
        )
    ).one()
    reviewers = await connection.scalars(
        select(review_assignments.c.user_id)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.released_at.is_(None),
        )
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    )
    return TaskSlide(
        slide_id=slide_id,
        result_set_id=row.result_set_id,
        run_set_ids=list(row.run_set_ids),
        reviewer_ids=list(reviewers),
    )
