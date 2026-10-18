import uuid
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.my_work import MAX_PAGE, list_my_slides
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.review_states import State
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import cases, review_assignments, review_task_slides, slides

MAX_LISTED = 200


class ListKind(StrEnum):
    TASK = "task"
    ALL_SLIDES = "all-slides"
    LIST = "list"


class SlideRef(BaseModel):
    id: uuid.UUID
    label: str
    case_label: str | None


class Neighbours(BaseModel):
    current: SlideRef
    previous: SlideRef | None
    next: SlideRef | None
    position: int
    total: int
    at_end: bool


class NotInListError(NotFoundError):
    code = "not-in-list"
    title = "This slide is not in that list"


class TaskNeededError(BadRequestError):
    code = "task-needed"
    title = "Name the task the slide was opened from"


class IdsNeededError(BadRequestError):
    code = "ids-needed"
    title = "Send the list of slides the slide was opened from"


router = APIRouter(prefix="/api/slides/{slide_id}/neighbours", tags=["slides"])


async def task_order(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    skip_submitted: bool,
) -> list[uuid.UUID]:
    _, whole = await readable_task(connection, principal, task_id)
    me = member_of(principal).user_id
    mine = {
        row.slide_id: row.submitted_at is not None
        for row in await connection.execute(
            select(review_assignments.c.slide_id, review_assignments.c.submitted_at).where(
                review_assignments.c.task_id == task_id, review_assignments.c.user_id == me
            )
        )
    }
    ordered = list(
        await connection.scalars(
            select(review_task_slides.c.slide_id)
            .where(review_task_slides.c.task_id == task_id)
            .order_by(review_task_slides.c.position)
        )
    )
    if mine or not whole:
        ordered = [slide for slide in ordered if slide in mine]
    if skip_submitted:
        ordered = [slide for slide in ordered if slide == slide_id or not mine.get(slide, False)]
    return ordered


async def all_slides_order(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    project_id: uuid.UUID | None,
    status: State | None,
    result_set: str | None,
    reviewer_id: uuid.UUID | None,
    q: str | None,
) -> list[uuid.UUID]:
    ordered: list[uuid.UUID] = []
    cursor: str | None = None
    while True:
        page = await list_my_slides(
            principal,
            connection,
            project_id=project_id,
            status=status,
            result_set=result_set,
            reviewer_id=reviewer_id,
            q=q,
            cursor=cursor,
            limit=MAX_PAGE,
        )
        ordered.extend(row.id for row in page.slides)
        if page.next_cursor is None:
            return ordered
        cursor = page.next_cursor


async def readable_ids(
    connection: AsyncConnection, principal: CurrentPrincipal, ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    seen = set(await all_slides_order(connection, principal, None, None, None, None, None))
    unique = list(dict.fromkeys(ids))
    return [slide for slide in unique if slide in seen]


async def refs(connection: AsyncConnection, ids: list[uuid.UUID]) -> dict[uuid.UUID, SlideRef]:
    rows = await connection.execute(
        select(slides.c.id, slides.c.label, cases.c.label.label("case_label"))
        .outerjoin(cases, cases.c.id == slides.c.case_id)
        .where(slides.c.id.in_(ids))
    )
    return {row.id: SlideRef(id=row.id, label=row.label, case_label=row.case_label) for row in rows}


@router.get("", operation_id="getSlideNeighbours", **require(Permission.SEE_SLIDES))
async def get_slide_neighbours(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    kind: Annotated[ListKind, Query(alias="from")],
    task_id: uuid.UUID | None = None,
    skip_submitted: bool = True,
    ids: Annotated[list[uuid.UUID] | None, Query(max_length=MAX_LISTED)] = None,
    project_id: uuid.UUID | None = None,
    status: State | None = None,
    result_set: Annotated[str | None, Query(max_length=120)] = None,
    reviewer_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> Neighbours:
    match kind:
        case ListKind.TASK:
            if task_id is None:
                raise TaskNeededError
            ordered = await task_order(connection, principal, task_id, slide_id, skip_submitted)
        case ListKind.ALL_SLIDES:
            ordered = await all_slides_order(
                connection, principal, project_id, status, result_set, reviewer_id, q
            )
        case ListKind.LIST:
            if not ids:
                raise IdsNeededError
            ordered = await readable_ids(connection, principal, ids)
    if slide_id not in ordered:
        raise NotInListError
    index = ordered.index(slide_id)
    before = ordered[index - 1] if index > 0 else None
    after = ordered[index + 1] if index + 1 < len(ordered) else None
    found = await refs(
        connection, [slide for slide in (before, slide_id, after) if slide is not None]
    )
    return Neighbours(
        current=found[slide_id],
        previous=found.get(before) if before else None,
        next=found.get(after) if after else None,
        position=index + 1,
        total=len(ordered),
        at_end=after is None,
    )
