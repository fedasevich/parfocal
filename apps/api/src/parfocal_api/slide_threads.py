import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.reviewed_layer import task_slide
from parfocal_api.slide_coverage import readable_slide
from parfocal_api.tables import project_members, threads
from parfocal_api.threads import (
    Sight,
    Thread,
    ThreadNotFoundError,
    list_in,
    messages_of,
    place_of,
    slide_place,
    visible_messages,
    visible_thread,
)

OWNER_ROLE = "owner"


class SlideThread(BaseModel):
    id: uuid.UUID
    slide_id: uuid.UUID
    task_id: uuid.UUID | None
    anchor: str
    replies: int = Field(ge=0)
    resolved: bool


class ThreadComment(BaseModel):
    id: uuid.UUID
    thread_id: uuid.UUID
    author_id: uuid.UUID
    author_is_researcher: bool
    text: str
    reply_to: uuid.UUID | None
    created_at: datetime


slide_router = APIRouter(prefix="/api/slides/{slide_id}/threads", tags=["slides"])
thread_router = APIRouter(prefix="/api/threads/{thread_id}", tags=["slides"])


def slide_thread_of(thread: Thread) -> SlideThread:
    return SlideThread(
        id=thread.id,
        slide_id=thread.slide_id,
        task_id=thread.task_id,
        anchor=thread.anchor.object_id or thread.anchor.kind.value,
        replies=max(0, thread.message_count - 1),
        resolved=thread.resolved_at is not None,
    )


async def readable_places(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, slide_id: uuid.UUID
) -> list[Any]:
    places: list[Any] = [await slide_place(connection, principal, project_id, slide_id)]
    task_ids = await connection.scalars(
        select(threads.c.task_id)
        .where(threads.c.slide_id == slide_id, threads.c.task_id.is_not(None))
        .distinct()
    )
    for task_id in sorted(task_ids.all(), key=str):
        try:
            places.append(await task_slide(connection, principal, task_id, slide_id))
        except NotFoundError, ForbiddenError:
            continue
    return places


@slide_router.get(
    "", operation_id="listSlideThreads", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_slide_threads(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[SlideThread]:
    slide = await readable_slide(connection, principal, slide_id)
    found: list[Thread] = []
    for place in await readable_places(connection, principal, slide.project_id, slide_id):
        found.extend(await list_in(connection, principal, place, None))
    found.sort(key=lambda thread: (thread.created_at, str(thread.id)))
    return [slide_thread_of(thread) for thread in found]


async def project_owners(connection: AsyncConnection, project_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await connection.scalars(
        select(project_members.c.user_id).where(
            project_members.c.project_id == project_id, project_members.c.role == OWNER_ROLE
        )
    )
    return set(rows.all())


@thread_router.get(
    "/comments",
    operation_id="listThreadComments",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_thread_comments(
    thread_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ThreadComment]:
    row = await visible_thread(connection, principal, thread_id)
    if row is None:
        raise ThreadNotFoundError
    sight = Sight(connection, principal, await place_of(connection, principal, row))
    messages = await visible_messages(sight, await messages_of(connection, [row.id]))
    owners = await project_owners(connection, row.project_id)
    return [
        ThreadComment(
            id=message.id,
            thread_id=thread_id,
            author_id=message.author_id,
            author_is_researcher=message.author_id in owners,
            text=message.body,
            reply_to=None,
            created_at=message.created_at,
        )
        for message in messages
    ]
