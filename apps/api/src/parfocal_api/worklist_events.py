import logging
import uuid
from collections.abc import Iterable, Mapping
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.realtime import Realtime, RoomEvent
from parfocal_api.tables import review_assignments, review_task_slides, review_tasks, uploads
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.jobs import Claimed, JobFinished

WORKLIST_CHANGED = "worklist.changed"

logger = logging.getLogger("parfocal.api.worklist")


def user_rooms(users: Iterable[uuid.UUID | None]) -> list[str]:
    return sorted({f"user:{user}" for user in users if user is not None})


def worklist_event(ids: Mapping[str, uuid.UUID]) -> RoomEvent:
    return RoomEvent(kind=WORKLIST_CHANGED, ids=dict(ids))


async def publish_quietly(
    live: Realtime, tenant_id: uuid.UUID, rooms: list[str], event: RoomEvent
) -> None:
    try:
        await live.publish(tenant_id, rooms, event)
    except Exception as error:
        logger.warning("worklist publish failed: %s", type(error).__name__)


def announce_worklist(
    background: BackgroundTasks,
    live: Realtime,
    tenant_id: uuid.UUID,
    users: Iterable[uuid.UUID | None],
    **ids: uuid.UUID,
) -> None:
    rooms = user_rooms(users)
    if rooms:
        background.add_task(publish_quietly, live, tenant_id, rooms, worklist_event(ids))


async def people_of(connection: AsyncConnection, statement: Any) -> set[uuid.UUID]:
    return {user for user in (await connection.scalars(statement)).all() if user is not None}


async def task_people(connection: AsyncConnection, task_id: uuid.UUID) -> set[uuid.UUID]:
    return await people_of(
        connection,
        union(
            select(review_tasks.c.created_by_user_id).where(review_tasks.c.id == task_id),
            select(review_assignments.c.user_id).where(review_assignments.c.task_id == task_id),
        ),
    )


async def slide_people(connection: AsyncConnection, slide_id: uuid.UUID) -> set[uuid.UUID]:
    return await people_of(
        connection,
        union(
            select(review_tasks.c.created_by_user_id)
            .join(review_task_slides, review_task_slides.c.task_id == review_tasks.c.id)
            .where(review_task_slides.c.slide_id == slide_id),
            select(review_assignments.c.user_id).where(review_assignments.c.slide_id == slide_id),
        ),
    )


async def upload_people(connection: AsyncConnection, upload_id: uuid.UUID) -> set[uuid.UUID]:
    return await people_of(
        connection, select(uploads.c.created_by_user_id).where(uploads.c.id == upload_id)
    )


PEOPLE_BY_INPUT = (
    ("task_id", "task", task_people),
    ("slide_id", "slide", slide_people),
    ("upload_id", "upload", upload_people),
)


def input_id(job: Claimed, key: str) -> uuid.UUID | None:
    value = job.input.get(key)
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def job_people(
    connection: AsyncConnection, job: Claimed
) -> tuple[set[uuid.UUID], dict[str, uuid.UUID]]:
    people: set[uuid.UUID] = set()
    ids = {"job": job.job_id}
    for key, name, find in PEOPLE_BY_INPUT:
        found = input_id(job, key)
        if found is not None:
            ids[name] = found
            people |= await find(connection, found)
    return people, ids


def job_announcer(engine: AsyncEngine, live: Realtime) -> JobFinished:
    async def announce_job(job: Claimed) -> None:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=job.tenant_id)) as connection:
            people, ids = await job_people(connection, job)
        rooms = user_rooms(people)
        if rooms:
            await publish_quietly(live, job.tenant_id, rooms, worklist_event(ids))

    return announce_job
