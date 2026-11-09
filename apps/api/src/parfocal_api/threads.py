import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
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
from parfocal_api.blind_first import hidden_objects
from parfocal_api.blinding import ai_hidden_on, require_ai_shown, sees_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.mentions import MAX_MENTIONS, BadMentionError, mentioned_in
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Grant, Permission, member_of, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import (
    principal_of,
    project_grant,
    reads_whole,
    require_slide_reading,
    reviews_slide,
    role_in,
)
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
    PrivacyMode,
    ProjectRole,
    annotations,
    memberships,
    projects,
    result_objects,
    result_sets,
    review_assignments,
    slides,
    thread_messages,
    threads,
    users,
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
    Letter.ARROW: AnnotationKind.ARROW,
    Letter.TEXT: AnnotationKind.TEXT,
}
OBJECT_ANCHORS = frozenset({AnchorKind.OBJECT, AnchorKind.ROI})
SHAPES = (PolygonGeometry, MultiPolygonGeometry, LineStringGeometry)


class Anchor(BaseModel):
    kind: AnchorKind
    object_id: str | None = None
    geometry: Geometry | None = None
    offset: Position | None = None
    result_set_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def fits_kind(self) -> Anchor:
        if self.result_set_id is not None and self.kind is not AnchorKind.OBJECT:
            raise ValueError("Only an object anchor names a result set")
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


class SlideThreadCreate(ThreadCreate):
    task_id: uuid.UUID | None = None


class PinMove(BaseModel):
    geometry: PointGeometry


class MessageCreate(BaseModel):
    body: Body


class Message(BaseModel):
    id: uuid.UUID
    author_id: uuid.UUID
    body: str
    mentions: list[uuid.UUID]
    created_at: datetime


class Mentionable(BaseModel):
    user_id: uuid.UUID
    display_name: str
    initials: str
    avatar_colour: int


class Thread(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None
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


class NotAPinError(BadRequestError):
    code = "not-a-pin"
    title = "Only a thread pinned to a point moves"


class BadAnchorError(BadRequestError):
    code = "bad-anchor"
    title = "This anchor does not name an object of this slide"


class ThreadHasRepliesError(ConflictError):
    code = "thread-has-replies"
    title = "This thread has replies. Confirm to delete them with it"


class NotThreadAuthorError(ForbiddenError):
    code = "not-thread-author"
    title = "Only the person who started the thread or a project owner deletes it"


class TaskNotOnSlideError(BadRequestError):
    code = "task-not-on-slide"
    title = "This task does not hold this slide in this project"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/threads", tags=["review-tasks"]
)
slide_router = APIRouter(
    prefix="/api/projects/{project_id}/slides/{slide_id}/threads", tags=["slides"]
)


@dataclass(frozen=True)
class SlidePlace:
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    slide_id: uuid.UUID
    case_id: uuid.UUID | None
    archived_at: datetime | None
    task_id: None = None
    signed_off_at: None = None
    result_set_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Anchored:
    object_id: str | None = None
    result_set_id: uuid.UUID | None = None


async def slide_place(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, slide_id: uuid.UUID
) -> SlidePlace:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id,
                slides.c.case_id,
                projects.c.privacy_mode,
                projects.c.archived_at,
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(
                slides.c.id == slide_id,
                slides.c.project_id == project_id,
                slides.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_slide_reading(
        connection,
        principal,
        project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Slide not found",
    )
    return SlidePlace(row.tenant_id, project_id, slide_id, row.case_id, row.archived_at)


async def place_of(connection: AsyncConnection, principal: Principal, row: Any) -> Any:
    if row.task_id is None:
        return await slide_place(connection, principal, row.project_id, row.slide_id)
    return await task_slide(connection, principal, row.task_id, row.slide_id)


@dataclass
class Sight:
    connection: AsyncConnection
    reader: Principal
    place: Any
    whole_authors: dict[uuid.UUID, bool] = field(default_factory=dict)
    seen: dict[uuid.UUID, bool] = field(default_factory=dict)
    hidden: bool | None = None
    blind: set[tuple[Letter, int]] | None = None

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
            self.seen[author] = await self.judge(author, self.place.task_id)
        return self.seen[author]

    async def judge(self, author: uuid.UUID, task_id: uuid.UUID | None) -> bool:
        if task_id is None:
            return (
                author == user_of(self.reader)
                or not await self.ai_hidden()
                or await self.reads_whole(author)
            )
        return await self.reads_whole(author) or await sees_reviewer(
            self.connection,
            self.reader,
            self.place.project_id,
            task_id,
            self.place.slide_id,
            author,
        )

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
        if mine or row.object_id is None:
            return True
        found = parse(row.object_id)
        if is_ai(found):
            return not await self.ai_hidden()
        return (found.letter, found.number) not in await self.blind_objects()

    async def blind_objects(self) -> set[tuple[Letter, int]]:
        if self.blind is None:
            self.blind = (
                set()
                if self.place.task_id is None
                else await hidden_objects(
                    self.connection, self.reader, self.place.task_id, self.place.slide_id
                )
            )
        return self.blind


def is_ai(found: ObjectId) -> bool:
    return found.letter in AI_LETTERS and not found.person


async def check_anchor(
    connection: AsyncConnection, principal: Principal, place: Any, anchor: Anchor
) -> Anchored:
    if anchor.object_id is None:
        return Anchored()
    try:
        found = parse(anchor.object_id)
    except ObjectIdError as error:
        raise BadAnchorError(str(error)) from error
    if (anchor.kind is AnchorKind.ROI) != (found.letter is Letter.ROI):
        raise BadAnchorError("An ROI anchor names an ROI, and an object anchor names no ROI")
    if is_ai(found):
        await require_ai_shown(connection, principal, place.project_id, place.slide_id)
        chosen = await check_ai_object(connection, place, found, anchor.result_set_id)
        return Anchored(found.text(ascii=True), chosen)
    if anchor.result_set_id is not None:
        raise BadAnchorError("Only an AI object anchor names a result set")
    kind = PERSON_KINDS.get(found.letter)
    drawn = select(annotations.c.id).where(
        annotations.c.slide_id == place.slide_id,
        annotations.c.kind == kind,
        annotations.c.number == found.number,
        annotations.c.deleted_at.is_(None),
    )
    hidden: set[tuple[Letter, int]] = (
        set()
        if place.task_id is None
        else await hidden_objects(connection, principal, place.task_id, place.slide_id)
    )
    if (
        kind is None
        or (found.letter, found.number) in hidden
        or not await connection.scalar(select(drawn.exists()))
    ):
        raise BadAnchorError(f"{found.text(ascii=True)} is not on this slide")
    return Anchored(found.text(ascii=True))


async def present_in(connection: AsyncConnection, place: Any, found: ObjectId) -> None:
    try:
        await check_exists(connection, place, found)
    except UnknownObjectError as error:
        raise BadAnchorError(str(error)) from error


async def require_set_on_slide(
    connection: AsyncConnection, place: SlidePlace, result_set_id: uuid.UUID
) -> None:
    on_slide = select(result_sets.c.id).where(
        result_sets.c.id == result_set_id,
        result_sets.c.slide_id == place.slide_id,
        result_sets.c.project_id == place.project_id,
        result_sets.c.deleted_at.is_(None),
    )
    if not await connection.scalar(select(on_slide.exists())):
        raise BadAnchorError("This result set is not on this slide")


async def sets_holding(
    connection: AsyncConnection, place: SlidePlace, found: ObjectId
) -> list[uuid.UUID]:
    holding = (
        select(result_objects.c.result_set_id)
        .join(result_sets, result_sets.c.id == result_objects.c.result_set_id)
        .where(
            result_sets.c.slide_id == place.slide_id,
            result_sets.c.deleted_at.is_(None),
            result_objects.c.kind == "region",
            result_objects.c.number == found.number,
        )
        .distinct()
    )
    return list((await connection.scalars(holding)).all())


async def check_ai_object(
    connection: AsyncConnection, place: Any, found: ObjectId, asked: uuid.UUID | None
) -> uuid.UUID | None:
    if place.task_id is not None:
        if asked is not None and asked != place.result_set_id:
            raise BadAnchorError("This task reviews another result set")
        await present_in(connection, place, found)
        return place.result_set_id
    if asked is not None:
        await require_set_on_slide(connection, place, asked)
        await present_in(connection, replace(place, result_set_id=asked), found)
        return asked
    if found.letter is not Letter.REGION:
        await present_in(connection, place, found)
        return None
    holding = await sets_holding(connection, place, found)
    if not holding:
        raise BadAnchorError(f"{found.text(ascii=True)} is not on this slide")
    if len(holding) > 1:
        raise BadAnchorError(
            f"{found.text(ascii=True)} is in {len(holding)} result sets on this slide. "
            "Name the result set"
        )
    return holding[0]


async def writable_place(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    return await writable(
        connection, principal, await task_slide(connection, principal, task_id, slide_id)
    )


async def writable_slide(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, slide_id: uuid.UUID
) -> SlidePlace:
    return await writable(
        connection, principal, await slide_place(connection, principal, project_id, slide_id)
    )


async def writable(connection: AsyncConnection, principal: Principal, place: Any) -> Any:
    member = member_of(principal)
    if place.archived_at is not None:
        raise ProjectArchivedError
    grant = await reviews_slide(connection, principal, place.project_id, place.slide_id)
    if grant is Grant.ASSIGNED and place.task_id is not None:
        assigned = select(review_assignments).where(
            review_assignments.c.task_id == place.task_id,
            review_assignments.c.slide_id == place.slide_id,
            review_assignments.c.user_id == member.user_id,
            review_assignments.c.released_at.is_(None),
        )
        if not await connection.scalar(select(assigned.exists())):
            raise NotAssignedError
    elif grant not in {Grant.ALL, Grant.ASSIGNED}:
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
            "result_set_id": row.result_set_id,
        }
    )


def message_of(row: Any) -> Message:
    return Message(
        id=row.id,
        author_id=row.user_id,
        body=row.body,
        mentions=mentioned_in(row.body),
        created_at=row.created_at,
    )


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
                threads.c.project_id == place.project_id,
                threads.c.slide_id == place.slide_id,
                threads.c.task_id.is_(None)
                if place.task_id is None
                else threads.c.task_id == place.task_id,
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
        place = await place_of(connection, principal, row)
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
        details={
            "task_id": str(row.task_id) if row.task_id else None,
            "slide_id": str(row.slide_id),
            **details,
        },
    )


async def reader_sight(connection: AsyncConnection, place: Any, person: uuid.UUID) -> Sight | None:
    reader = await principal_of(connection, place.tenant_id, person)
    if reader is None:
        return None
    try:
        seen = await place_of(connection, reader, place)
    except NotFoundError, ForbiddenError:
        return None
    return Sight(connection, reader, seen)


async def who_sees_the_post(
    connection: AsyncConnection,
    place: Any,
    row: Any,
    poster: uuid.UUID,
    people: Iterable[uuid.UUID],
) -> list[uuid.UUID]:
    found: list[uuid.UUID] = []
    for person in sorted(people):
        sight = await reader_sight(connection, place, person)
        if sight is not None and await sight.sees_thread(row) and await sight.sees(poster):
            found.append(person)
    return found


async def checked_mentions(
    connection: AsyncConnection, place: Any, row: Any, poster: Sight, body: str
) -> list[uuid.UUID]:
    me = member_of(poster.reader).user_id
    named = [person for person in mentioned_in(body) if person != me]
    if len(named) > MAX_MENTIONS:
        raise BadMentionError(f"A message mentions at most {MAX_MENTIONS} people")
    allowed = await who_sees_the_post(connection, place, row, me, named)
    for person in named:
        if person not in allowed or not await poster.sees(person):
            raise BadMentionError
    return named


async def tell_followers(
    connection: AsyncConnection,
    place: Any,
    row: Any,
    poster: uuid.UUID,
    mentioned: list[uuid.UUID],
) -> None:
    followers = {row.created_by_user_id} | set(
        await connection.scalars(
            select(thread_messages.c.user_id).where(thread_messages.c.thread_id == row.id)
        )
    )
    followers.discard(poster)
    followers.difference_update(mentioned)
    payload = {"slide_id": str(place.slide_id)}
    if place.task_id is not None:
        payload["task_id"] = str(place.task_id)
    await notify(
        connection,
        place.tenant_id,
        await who_sees_the_post(connection, place, row, poster, followers),
        NotificationKind.REPLY,
        TargetKind.THREAD,
        row.id,
        payload,
    )
    await notify(
        connection,
        place.tenant_id,
        mentioned,
        NotificationKind.MENTION,
        TargetKind.THREAD,
        row.id,
        payload,
    )


async def list_in(
    connection: AsyncConnection, principal: Principal, place: Any, resolved: bool | None
) -> list[Thread]:
    sight = Sight(connection, principal, place)
    query = select(threads).where(
        threads.c.project_id == place.project_id,
        threads.c.slide_id == place.slide_id,
        threads.c.task_id.is_(None)
        if place.task_id is None
        else threads.c.task_id == place.task_id,
    )
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


async def mentionable_in(
    connection: AsyncConnection, principal: Principal, place: Any
) -> list[Mentionable]:
    me = member_of(principal).user_id
    own = Sight(connection, principal, place)
    rows = await connection.execute(
        select(users.c.id, users.c.display_name, users.c.initials, users.c.avatar_colour)
        .join(memberships, memberships.c.user_id == users.c.id)
        .where(memberships.c.tenant_id == place.tenant_id, users.c.id != me)
        .order_by(users.c.display_name, users.c.id)
    )
    found: list[Mentionable] = []
    for row in rows:
        other = await reader_sight(connection, place, row.id)
        if other is not None and await own.sees(row.id) and await other.sees(me):
            found.append(
                Mentionable(
                    user_id=row.id,
                    display_name=row.display_name,
                    initials=row.initials,
                    avatar_colour=row.avatar_colour,
                )
            )
    return found


async def start_in(
    connection: AsyncConnection,
    principal: Principal,
    place: Any,
    draft: ThreadCreate,
    http: Request,
    background: BackgroundTasks,
) -> ThreadDetail:
    if place.signed_off_at is not None:
        raise TaskSignedOffError
    anchored = await check_anchor(connection, principal, place, draft.anchor)
    object_id = anchored.object_id
    me = member_of(principal).user_id
    offset = draft.anchor.offset
    geometry = draft.anchor.geometry
    row = (
        await connection.execute(
            insert(threads)
            .values(
                tenant_id=place.tenant_id,
                project_id=place.project_id,
                task_id=place.task_id,
                slide_id=place.slide_id,
                title=draft.title,
                anchor_kind=draft.anchor.kind,
                object_id=object_id,
                geometry=geometry.model_dump() if geometry is not None else None,
                offset_x=offset[0] if offset else None,
                offset_y=offset[1] if offset else None,
                result_set_id=anchored.result_set_id,
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
    own = Sight(connection, principal, place)
    mentioned = await checked_mentions(connection, place, row, own, draft.body)
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
            "mentions": len(mentioned),
        },
    )
    await tell_followers(connection, place, row, me, mentioned)
    background.add_task(deliver_after_commit, http.app, place.tenant_id)
    return await detail(Sight(connection, principal, place), row)


async def get_in(
    connection: AsyncConnection, principal: Principal, place: Any, thread_id: uuid.UUID
) -> ThreadDetail:
    sight = Sight(connection, principal, place)
    return await detail(sight, await thread_row(connection, place, thread_id, sight))


async def reply_in(
    connection: AsyncConnection,
    principal: Principal,
    place: Any,
    thread_id: uuid.UUID,
    draft: MessageCreate,
    http: Request,
    background: BackgroundTasks,
) -> Message:
    row = await thread_row(connection, place, thread_id, Sight(connection, principal, place))
    me = member_of(principal).user_id
    message = (
        await connection.execute(
            insert(thread_messages)
            .values(tenant_id=place.tenant_id, thread_id=row.id, user_id=me, body=draft.body)
            .returning(*thread_messages.c)
        )
    ).one()
    own = Sight(connection, principal, place)
    mentioned = await checked_mentions(connection, place, row, own, draft.body)
    await tell_followers(connection, place, row, me, mentioned)
    await audit(
        connection,
        principal,
        AuditAction.THREAD_REPLIED,
        row,
        {
            "message_id": str(message.id),
            "message_length": len(draft.body),
            "mentions": len(mentioned),
        },
    )
    background.add_task(deliver_after_commit, http.app, place.tenant_id)
    return message_of(message)


async def resolve_in(
    connection: AsyncConnection,
    principal: Principal,
    place: Any,
    thread_id: uuid.UUID,
    *,
    resolved: bool,
) -> ThreadDetail:
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


async def require_author_or_owner(
    connection: AsyncConnection, principal: Principal, place: Any, row: Any
) -> None:
    if (
        row.created_by_user_id != member_of(principal).user_id
        and await role_in(connection, principal, place.project_id) is not ProjectRole.OWNER
    ):
        raise NotThreadAuthorError


async def move_in(
    connection: AsyncConnection,
    principal: Principal,
    place: Any,
    thread_id: uuid.UUID,
    move: PinMove,
) -> ThreadDetail:
    if place.signed_off_at is not None:
        raise TaskSignedOffError
    sight = Sight(connection, principal, place)
    row = await thread_row(connection, place, thread_id, sight)
    if AnchorKind(row.anchor_kind) is not AnchorKind.POINT:
        raise NotAPinError
    await require_author_or_owner(connection, principal, place, row)
    row = (
        await connection.execute(
            update(threads)
            .where(threads.c.id == thread_id)
            .values(geometry=move.geometry.model_dump())
            .returning(*threads.c)
        )
    ).one()
    await audit(connection, principal, AuditAction.THREAD_MOVED, row, {})
    return await detail(sight, row)


async def delete_in(
    connection: AsyncConnection,
    principal: Principal,
    place: Any,
    thread_id: uuid.UUID,
    confirm: bool,
) -> Response:
    row = await thread_row(connection, place, thread_id, Sight(connection, principal, place))
    await require_author_or_owner(connection, principal, place, row)
    count = await connection.scalar(
        select(func.count()).where(thread_messages.c.thread_id == thread_id)
    )
    replies = max(int(count or 0) - 1, 0)
    if replies and not confirm:
        raise ThreadHasRepliesError(f"The thread has {replies} replies")
    await connection.execute(delete(threads).where(threads.c.id == thread_id))
    await audit(connection, principal, AuditAction.THREAD_DELETED, row, {"replies": replies})
    return Response(status_code=204)


@router.get("", operation_id="listThreads", **require(Permission.SEE_SLIDES, emergency=True))
async def list_threads(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    resolved: bool | None = None,
) -> list[Thread]:
    place = await task_slide(connection, principal, task_id, slide_id)
    return await list_in(connection, principal, place, resolved)


@router.get("/mentionable", operation_id="listMentionableMembers", **require(Permission.SEE_SLIDES))
async def list_mentionable(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[Mentionable]:
    place = await task_slide(connection, principal, task_id, slide_id)
    return await mentionable_in(connection, principal, place)


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
    http: Request,
    background: BackgroundTasks,
) -> ThreadDetail:
    place = await writable_place(connection, principal, task_id, slide_id)
    return await start_in(connection, principal, place, draft, http, background)


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
    return await get_in(connection, principal, place, thread_id)


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
    return await reply_in(connection, principal, place, thread_id, draft, http, background)


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
    place = await writable_place(connection, principal, task_id, slide_id)
    return await resolve_in(connection, principal, place, thread_id, resolved=True)


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
    place = await writable_place(connection, principal, task_id, slide_id)
    return await resolve_in(connection, principal, place, thread_id, resolved=False)


@router.patch(
    "/{thread_id}/anchor",
    operation_id="moveThread",
    **require(Permission.REVIEW, write=True),
)
async def move_thread(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    move: PinMove,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await writable_place(connection, principal, task_id, slide_id)
    return await move_in(connection, principal, place, thread_id, move)


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
    return await delete_in(connection, principal, place, thread_id, confirm)


@slide_router.get(
    "", operation_id="listThreadsOnSlide", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_threads_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    resolved: bool | None = None,
) -> list[Thread]:
    place = await slide_place(connection, principal, project_id, slide_id)
    return await list_in(connection, principal, place, resolved)


@slide_router.get(
    "/mentionable",
    operation_id="listMentionableMembersOnSlide",
    **require(Permission.SEE_SLIDES),
)
async def list_mentionable_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[Mentionable]:
    place = await slide_place(connection, principal, project_id, slide_id)
    return await mentionable_in(connection, principal, place)


@slide_router.post(
    "",
    operation_id="createThreadOnSlide",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    draft: SlideThreadCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> ThreadDetail:
    if draft.task_id is None:
        place = await writable_slide(connection, principal, project_id, slide_id)
    else:
        place = await writable_place(connection, principal, draft.task_id, slide_id)
        if place.project_id != project_id:
            raise TaskNotOnSlideError
    return await start_in(connection, principal, place, draft, http, background)


@slide_router.get(
    "/{thread_id}",
    operation_id="getThreadOnSlide",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await slide_place(connection, principal, project_id, slide_id)
    return await get_in(connection, principal, place, thread_id)


@slide_router.post(
    "/{thread_id}/messages",
    operation_id="replyToThreadOnSlide",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def reply_to_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    draft: MessageCreate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> Message:
    place = await writable_slide(connection, principal, project_id, slide_id)
    return await reply_in(connection, principal, place, thread_id, draft, http, background)


@slide_router.post(
    "/{thread_id}/resolve",
    operation_id="resolveThreadOnSlide",
    **require(Permission.REVIEW, write=True),
)
async def resolve_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await writable_slide(connection, principal, project_id, slide_id)
    return await resolve_in(connection, principal, place, thread_id, resolved=True)


@slide_router.post(
    "/{thread_id}/reopen",
    operation_id="reopenThreadOnSlide",
    **require(Permission.REVIEW, write=True),
)
async def reopen_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await writable_slide(connection, principal, project_id, slide_id)
    return await resolve_in(connection, principal, place, thread_id, resolved=False)


@slide_router.patch(
    "/{thread_id}/anchor",
    operation_id="moveThreadOnSlide",
    **require(Permission.REVIEW, write=True),
)
async def move_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    move: PinMove,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ThreadDetail:
    place = await writable_slide(connection, principal, project_id, slide_id)
    return await move_in(connection, principal, place, thread_id, move)


@slide_router.delete(
    "/{thread_id}",
    operation_id="deleteThreadOnSlide",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def delete_thread_on_slide(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    thread_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    confirm: bool = False,
) -> Response:
    place = await writable_slide(connection, principal, project_id, slide_id)
    return await delete_in(connection, principal, place, thread_id, confirm)
