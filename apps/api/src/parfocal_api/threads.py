import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, StringConstraints, model_validator
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import (
    Geometry,
    LineStringGeometry,
    MultiPolygonGeometry,
    PointGeometry,
    PolygonGeometry,
    Position,
)
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on, require_ai_shown, sees_reviewer
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Grant, Permission, member_of, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, reads_whole, reviews_slide, role_in
from parfocal_api.projects import ProjectArchivedError
from parfocal_api.reviewed_layer import (
    NotAssignedError,
    TaskSignedOffError,
    UnknownObjectError,
    check_exists,
    task_slide,
)
from parfocal_api.tables import (
    AnchorKind,
    AnnotationKind,
    NotificationKind,
    ProjectRole,
    Role,
    annotations,
    memberships,
    review_assignments,
    thread_messages,
    threads,
)
from parfocal_common.object_ids import Letter, ObjectId, ObjectIdError, parse

type Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
type Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]

AI_LETTERS = frozenset({Letter.REGION, Letter.CELL})
PERSON_KINDS = {
    Letter.REGION: AnnotationKind.REGION,
    Letter.CELL: AnnotationKind.CELL,
    Letter.ROI: AnnotationKind.ROI,
    Letter.MEASUREMENT: AnnotationKind.MEASUREMENT,
}
OBJECT_ANCHORS = frozenset({AnchorKind.OBJECT, AnchorKind.ROI})
SHAPES = (PolygonGeometry, MultiPolygonGeometry, LineStringGeometry)


class Anchor(BaseModel):
    kind: AnchorKind
    object_id: str | None = None
    geometry: Geometry | None = None
    offset: Position | None = None

    @model_validator(mode="after")
    def fits_kind(self) -> Anchor:
        if (self.kind in OBJECT_ANCHORS) != (self.object_id is not None):
            raise ValueError("An object or ROI anchor names an object ID, and only it does")
        if (self.kind not in OBJECT_ANCHORS) != (self.geometry is not None):
            raise ValueError("A point or shape anchor gives a geometry, and only it does")
        if self.offset is not None and self.kind not in OBJECT_ANCHORS:
            raise ValueError("Only an object or ROI anchor takes an offset")
        if self.kind is AnchorKind.POINT and not isinstance(self.geometry, PointGeometry):
            raise ValueError("A point anchor is a Point")
        if self.kind is AnchorKind.SHAPE and not isinstance(self.geometry, SHAPES):
            raise ValueError("A shape anchor is a Polygon, MultiPolygon or LineString")
        return self


class ThreadCreate(BaseModel):
    title: Title
    body: Body
    anchor: Anchor


class MessageCreate(BaseModel):
    body: Body


class Message(BaseModel):
    id: uuid.UUID
    author_id: uuid.UUID
    body: str
    created_at: datetime


class Thread(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID
    slide_id: uuid.UUID
    title: str
    anchor: Anchor
    created_by: uuid.UUID
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    message_count: int
    last_message_at: datetime


class ThreadDetail(Thread):
    messages: list[Message]


class ThreadNotFoundError(NotFoundError):
    code = "thread-not-found"
    title = "There is no such thread for you"


class BadAnchorError(BadRequestError):
    code = "bad-anchor"
    title = "This anchor does not name an object of this slide"


class ThreadHasRepliesError(ConflictError):
    code = "thread-has-replies"
    title = "This thread has replies. Confirm to delete them with it"


class NotThreadAuthorError(ForbiddenError):
    code = "not-thread-author"
    title = "Only the person who started the thread or a project owner deletes it"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/threads", tags=["review-tasks"]
)


@dataclass
class Sight:
    connection: AsyncConnection
    reader: Principal
    place: Any
    whole_authors: dict[uuid.UUID, bool] = field(default_factory=dict)
    seen: dict[uuid.UUID, bool] = field(default_factory=dict)
    hidden: bool | None = None

    async def reads_whole(self, author: uuid.UUID) -> bool:
        if author not in self.whole_authors:
            person = await principal_of(self.connection, self.place.tenant_id, author)
            self.whole_authors[author] = person is not None and reads_whole(
                await project_grant(
                    self.connection, person, self.place.project_id, Permission.SEE_SLIDES
                )
            )
        return self.whole_authors[author]

    async def sees(self, author: uuid.UUID) -> bool:
        if author not in self.seen:
            self.seen[author] = await self.reads_whole(author) or await sees_reviewer(
                self.connection,
                self.reader,
                self.place.project_id,
                self.place.task_id,
                self.place.slide_id,
                author,
            )
        return self.seen[author]

    async def ai_hidden(self) -> bool:
        if self.hidden is None:
            self.hidden = await ai_hidden_on(
                self.connection, self.reader, self.place.project_id, self.place.slide_id
            )
        return self.hidden

    async def sees_thread(self, row: Any) -> bool:
        if not await self.sees(row.created_by_user_id):
            return False
        mine = isinstance(self.reader, MemberPrincipal) and (
            self.reader.user_id == row.created_by_user_id
        )
        if not mine and row.object_id is not None and is_ai(parse(row.object_id)):
            return not await self.ai_hidden()
        return True


async def principal_of(
    connection: AsyncConnection, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> MemberPrincipal | None:
    row = (
        await connection.execute(
            select(memberships.c.role, memberships.c.admin_rights).where(
                memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return MemberPrincipal("", tenant_id, user_id, Role(row.role), row.admin_rights)


def is_ai(found: ObjectId) -> bool:
    return found.letter in AI_LETTERS and not found.person


async def check_anchor(
    connection: AsyncConnection, principal: Principal, place: Any, anchor: Anchor
) -> str | None:
    if anchor.object_id is None:
        return None
    try:
        found = parse(anchor.object_id)
    except ObjectIdError as error:
        raise BadAnchorError(str(error)) from error
    if (anchor.kind is AnchorKind.ROI) != (found.letter is Letter.ROI):
        raise BadAnchorError("An ROI anchor names an ROI, and an object anchor names no ROI")
    if is_ai(found):
        await require_ai_shown(connection, principal, place.project_id, place.slide_id)
        try:
            await check_exists(connection, place, found)
        except UnknownObjectError as error:
            raise BadAnchorError(str(error)) from error
        return found.text(ascii=True)
    kind = PERSON_KINDS.get(found.letter)
    drawn = select(annotations.c.id).where(
        annotations.c.slide_id == place.slide_id,
        annotations.c.kind == kind,
        annotations.c.number == found.number,
        annotations.c.deleted_at.is_(None),
    )
    if kind is None or not await connection.scalar(select(drawn.exists())):
        raise BadAnchorError(f"{found.text(ascii=True)} is not on this slide")
    return found.text(ascii=True)


async def writable_place(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    member = member_of(principal)
    place = await task_slide(connection, principal, task_id, slide_id)
    if place.archived_at is not None:
        raise ProjectArchivedError
    grant = await reviews_slide(connection, principal, place.project_id, slide_id)
    if grant is Grant.ASSIGNED:
        assigned = select(review_assignments).where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == member.user_id,
            review_assignments.c.released_at.is_(None),
        )
        if not await connection.scalar(select(assigned.exists())):
            raise NotAssignedError
    elif grant is not Grant.ALL:
        raise ForbiddenError
    return place


def anchor_of(row: Any) -> Anchor:
    offset = (row.offset_x, row.offset_y) if row.offset_x is not None else None
    return Anchor.model_validate(
        {
            "kind": row.anchor_kind,
            "object_id": row.object_id,
            "geometry": row.geometry,
            "offset": offset,
        }
    )


def message_of(row: Any) -> Message:
    return Message(id=row.id, author_id=row.user_id, body=row.body, created_at=row.created_at)


def thread_of(row: Any, messages: list[Message]) -> ThreadDetail:
    return ThreadDetail(
        id=row.id,
        project_id=row.project_id,
        task_id=row.task_id,
        slide_id=row.slide_id,
        title=row.title,
        anchor=anchor_of(row),
        created_by=row.created_by_user_id,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
        resolved_by=row.resolved_by_user_id,
        message_count=len(messages),
        last_message_at=max((message.created_at for message in messages), default=row.created_at),
        messages=messages,
    )


async def visible_messages(sight: Sight, rows: Iterable[Any]) -> list[Message]:
    return [message_of(row) for row in rows if await sight.sees(row.user_id)]


async def messages_of(connection: AsyncConnection, thread_ids: list[uuid.UUID]) -> list[Any]:
    if not thread_ids:
        return []
    return list(
        await connection.execute(
            select(thread_messages)
            .where(thread_messages.c.thread_id.in_(thread_ids))
            .order_by(thread_messages.c.created_at, thread_messages.c.id)
        )
    )


async def thread_row(
    connection: AsyncConnection, place: Any, thread_id: uuid.UUID, sight: Sight
) -> Any:
    row = (
        await connection.execute(
            select(threads).where(
                threads.c.id == thread_id,
                threads.c.task_id == place.task_id,
                threads.c.slide_id == place.slide_id,
            )
        )
    ).one_or_none()
    if row is None or not await sight.sees_thread(row):
        raise ThreadNotFoundError
    return row


async def detail(sight: Sight, row: Any) -> ThreadDetail:
    rows = await messages_of(sight.connection, [row.id])
    return thread_of(row, await visible_messages(sight, rows))


async def visible_thread(
    connection: AsyncConnection, principal: Principal, thread_id: uuid.UUID
) -> Any | None:
    row = (await connection.execute(select(threads).where(threads.c.id == thread_id))).one_or_none()
    if row is None:
        return None
    try:
        place = await task_slide(connection, principal, row.task_id, row.slide_id)
    except NotFoundError, ForbiddenError:
        return None
    if not await Sight(connection, principal, place).sees_thread(row):
        return None
    return row


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Any,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.THREAD,
        row.id,
        tenant_id=row.tenant_id,
        details={"task_id": str(row.task_id), "slide_id": str(row.slide_id), **details},
    )


async def tell_followers(
    connection: AsyncConnection, place: Any, row: Any, poster: uuid.UUID
) -> None:
    followers = {row.created_by_user_id} | set(
        await connection.scalars(
            select(thread_messages.c.user_id).where(thread_messages.c.thread_id == row.id)
        )
    )
    followers.discard(poster)
    told: list[uuid.UUID] = []
    for person in sorted(followers):
        reader = await principal_of(connection, place.tenant_id, person)
        if reader is None:
            continue
        try:
            seen = await task_slide(connection, reader, place.task_id, place.slide_id)
        except NotFoundError, ForbiddenError:
            continue
        sight = Sight(connection, reader, seen)
        if await sight.sees_thread(row) and await sight.sees(poster):
            told.append(person)
    await notify(
        connection,
        place.tenant_id,
        told,
        NotificationKind.REPLY,
        TargetKind.THREAD,
        row.id,
        {"task_id": str(place.task_id), "slide_id": str(place.slide_id)},
    )


@router.get("", operation_id="listThreads", **require(Permission.SEE_SLIDES, emergency=True))
async def list_threads(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    resolved: bool | None = None,
) -> list[Thread]:
    place = await task_slide(connection, principal, task_id, slide_id)
    sight = Sight(connection, principal, place)
    query = select(threads).where(threads.c.task_id == task_id, threads.c.slide_id == slide_id)
    if resolved is not None:
        query = query.where(
            threads.c.resolved_at.is_not(None) if resolved else threads.c.resolved_at.is_(None)
        )
    rows = [
        row
        for row in await connection.execute(query.order_by(threads.c.created_at, threads.c.id))
        if await sight.sees_thread(row)
    ]
    messages = await messages_of(connection, [row.id for row in rows])
    found: list[Thread] = []
    for row in rows:
        shown = await visible_messages(
            sight, (message for message in messages if message.thread_id == row.id)
        )
        found.append(Thread.model_validate(thread_of(row, shown).model_dump(exclude={"messages"})))
    return found


@router.post(
    "",
    operation_id="createThread",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    draft: ThreadCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await writable_place(connection, principal, task_id, slide_id)
    if place.signed_off_at is not None:
        raise TaskSignedOffError
    object_id = await check_anchor(connection, principal, place, draft.anchor)
    me = member_of(principal).user_id
    offset = draft.anchor.offset
    geometry = draft.anchor.geometry
    row = (
        await connection.execute(
            insert(threads)
            .values(
                tenant_id=place.tenant_id,
                project_id=place.project_id,
                task_id=task_id,
                slide_id=slide_id,
                title=draft.title,
                anchor_kind=draft.anchor.kind,
                object_id=object_id,
                geometry=geometry.model_dump() if geometry is not None else None,
                offset_x=offset[0] if offset else None,
                offset_y=offset[1] if offset else None,
                created_by_user_id=me,
            )
            .returning(*threads.c)
        )
    ).one()
    await connection.execute(
        insert(thread_messages).values(
            tenant_id=place.tenant_id, thread_id=row.id, user_id=me, body=draft.body
        )
    )
    await audit(
        connection,
        principal,
        AuditAction.THREAD_CREATED,
        row,
        {
            "anchor": draft.anchor.kind.value,
            "object": object_id,
            "title_length": len(draft.title),
            "message_length": len(draft.body),
        },
    )
    return await detail(Sight(connection, principal, place), row)


@router.get(
    "/{thread_id}", operation_id="getThread", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await task_slide(connection, principal, task_id, slide_id)
    sight = Sight(connection, principal, place)
    return await detail(sight, await thread_row(connection, place, thread_id, sight))


@router.post(
    "/{thread_id}/messages",
    operation_id="replyToThread",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def reply_to_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    draft: MessageCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> Message:
    place = await writable_place(connection, principal, task_id, slide_id)
    row = await thread_row(connection, place, thread_id, Sight(connection, principal, place))
    me = member_of(principal).user_id
    message = (
        await connection.execute(
            insert(thread_messages)
            .values(tenant_id=place.tenant_id, thread_id=row.id, user_id=me, body=draft.body)
            .returning(*thread_messages.c)
        )
    ).one()
    await tell_followers(connection, place, row, me)
    await audit(
        connection,
        principal,
        AuditAction.THREAD_REPLIED,
        row,
        {"message_id": str(message.id), "message_length": len(draft.body)},
    )
    background.add_task(deliver_after_commit, http.app, place.tenant_id)
    return message_of(message)


async def set_resolved(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: Principal,
    connection: AsyncConnection,
    *,
    resolved: bool,
) -> ThreadDetail:
    place = await writable_place(connection, principal, task_id, slide_id)
    sight = Sight(connection, principal, place)
    row = await thread_row(connection, place, thread_id, sight)
    if (row.resolved_at is not None) != resolved:
        row = (
            await connection.execute(
                update(threads)
                .where(threads.c.id == thread_id)
                .values(
                    resolved_at=func.now() if resolved else None,
                    resolved_by_user_id=member_of(principal).user_id if resolved else None,
                )
                .returning(*threads.c)
            )
        ).one()
        action = AuditAction.THREAD_RESOLVED if resolved else AuditAction.THREAD_REOPENED
        await audit(connection, principal, action, row, {})
    return await detail(sight, row)


@router.post(
    "/{thread_id}/resolve",
    operation_id="resolveThread",
    **require(Permission.REVIEW, write=True),
)
async def resolve_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    return await set_resolved(task_id, slide_id, thread_id, principal, connection, resolved=True)


@router.post(
    "/{thread_id}/reopen",
    operation_id="reopenThread",
    **require(Permission.REVIEW, write=True),
)
async def reopen_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    return await set_resolved(task_id, slide_id, thread_id, principal, connection, resolved=False)


@router.delete(
    "/{thread_id}",
    operation_id="deleteThread",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def delete_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    confirm: bool = False,
) -> Response:
    place = await writable_place(connection, principal, task_id, slide_id)
    row = await thread_row(connection, place, thread_id, Sight(connection, principal, place))
    me = member_of(principal).user_id
    if (
        row.created_by_user_id != me
        and await role_in(connection, principal, place.project_id) is not ProjectRole.OWNER
    ):
        raise NotThreadAuthorError
    count = await connection.scalar(
        select(func.count()).where(thread_messages.c.thread_id == thread_id)
    )
    replies = max(int(count or 0) - 1, 0)
    if replies and not confirm:
        raise ThreadHasRepliesError(f"The thread has {replies} replies")
    await connection.execute(delete(threads).where(threads.c.id == thread_id))
    await audit(connection, principal, AuditAction.THREAD_DELETED, row, {"replies": replies})
    return Response(status_code=204)
