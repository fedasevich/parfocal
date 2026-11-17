import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.tables import (
    ActorKind,
    TaskKind,
    TaskSplit,
    review_assignments,
    review_task_slides,
    review_tasks,
    webhook_calls,
)

WEBHOOK_ACTOR = Actor(ActorKind.SYSTEM)


async def reviewers_for(connection: AsyncConnection, task: Any) -> list[uuid.UUID]:
    rows = (
        await connection.execute(
            select(review_assignments.c.user_id, func.count().label("slides"))
            .where(review_assignments.c.task_id == task.id)
            .group_by(review_assignments.c.user_id)
            .order_by(func.count(), func.min(review_assignments.c.assigned_at))
        )
    ).all()
    people = [row.user_id for row in rows]
    if task.split == TaskSplit.EVERYONE or not people:
        return people
    return people[:1]


async def attach(
    connection: AsyncConnection, task: Any, slide_id: uuid.UUID, result_set_id: uuid.UUID | None
) -> bool:
    position = await connection.scalar(
        select(func.coalesce(func.max(review_task_slides.c.position), -1) + 1).where(
            review_task_slides.c.task_id == task.id
        )
    )
    added = await connection.scalar(
        insert(review_task_slides)
        .values(
            tenant_id=task.tenant_id,
            project_id=task.project_id,
            task_id=task.id,
            slide_id=slide_id,
            position=position,
            kind=task.kind,
            result_set_id=result_set_id if task.kind == TaskKind.REVIEW else None,
        )
        .on_conflict_do_nothing()
        .returning(review_task_slides.c.slide_id)
    )
    if added is None:
        return False
    people = await reviewers_for(connection, task)
    if people:
        await connection.execute(
            insert(review_assignments),
            [
                {
                    "tenant_id": task.tenant_id,
                    "task_id": task.id,
                    "slide_id": slide_id,
                    "user_id": user,
                }
                for user in people
            ],
        )
    return True


async def attach_waiting_tasks(
    connection: AsyncConnection,
    slide_upload_id: uuid.UUID | None,
    slide_id: uuid.UUID,
    result_set_id: uuid.UUID | None,
) -> None:
    if slide_upload_id is None:
        return
    waiting = (
        await connection.execute(
            select(webhook_calls.c.id, webhook_calls.c.webhook_id, webhook_calls.c.task_id)
            .where(
                webhook_calls.c.slide_upload_id == slide_upload_id,
                webhook_calls.c.task_id.is_not(None),
                webhook_calls.c.task_attached_at.is_(None),
            )
            .with_for_update()
        )
    ).all()
    for call in waiting:
        task = (
            await connection.execute(select(review_tasks).where(review_tasks.c.id == call.task_id))
        ).one_or_none()
        if task is None:
            continue
        if task.kind == TaskKind.REVIEW and result_set_id is None:
            continue
        added = await attach(connection, task, slide_id, result_set_id)
        await connection.execute(
            update(webhook_calls)
            .where(webhook_calls.c.id == call.id)
            .values(task_attached_at=func.now())
        )
        await record(
            connection,
            WEBHOOK_ACTOR,
            AuditAction.WEBHOOK_TASK_ATTACHED,
            AuditTarget.WEBHOOK,
            call.webhook_id,
            tenant_id=task.tenant_id,
            details={
                "task_id": str(task.id),
                "slide_id": str(slide_id),
                "call_id": str(call.id),
                "added": added,
            },
        )
