import uuid

from sqlalchemy import ColumnElement, Select, and_, false, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.permissions import Permission
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, ForbiddenError
from parfocal_api.project_access import project_grant, readable, reads_whole
from parfocal_api.tables import (
    annotations,
    opinions,
    review_assignments,
    review_edits,
    review_tasks,
    verdicts,
)


class OtherReviewerError(ForbiddenError):
    code = "other-reviewer"
    title = "You see another reviewer's work on this slide only after you submit it"


class AiHiddenError(ForbiddenError):
    code = "ai-hidden"
    title = "The AI stays hidden on this slide until you record your first read"


class FirstReadOpenError(ConflictError):
    code = "first-read-open"
    title = "Record your first read before you judge the AI's objects"


class FirstReadStartedError(ConflictError):
    code = "task-started"
    title = "Reviewers have started, so the first read can no longer be switched on or off"


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


def open_first_reads(principal: Principal) -> Select[tuple[uuid.UUID]]:
    return (
        select(review_assignments.c.slide_id)
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(
            review_assignments.c.user_id == user_of(principal),
            review_tasks.c.archived_at.is_(None),
            review_tasks.c.ai_hidden_first_read.is_(True),
            review_assignments.c.first_read_at.is_(None),
        )
    )


def ai_hidden(
    principal: Principal,
    project_column: ColumnElement[uuid.UUID],
    slide_column: ColumnElement[uuid.UUID],
) -> ColumnElement[bool]:
    if not isinstance(principal, MemberPrincipal):
        return false()
    return and_(slide_column.in_(open_first_reads(principal)), ~readable(principal, project_column))


async def sees_whole(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> bool:
    return reads_whole(
        await project_grant(connection, principal, project_id, Permission.SEE_SLIDES)
    )


async def ai_hidden_on(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> bool:
    if not isinstance(principal, MemberPrincipal):
        return False
    if await sees_whole(connection, principal, project_id):
        return False
    mine = open_first_reads(principal).where(review_assignments.c.slide_id == slide_id)
    return bool(await connection.scalar(select(mine.exists())))


async def require_ai_shown(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> None:
    if await ai_hidden_on(connection, principal, project_id, slide_id):
        raise AiHiddenError


async def first_read_open(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> bool:
    mine = (
        select(review_assignments.c.slide_id)
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == user_of(principal),
            review_tasks.c.ai_hidden_first_read.is_(True),
            review_assignments.c.first_read_at.is_(None),
        )
    )
    return bool(await connection.scalar(select(mine.exists())))


async def require_judging_allowed(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> None:
    if await first_read_open(connection, principal, task_id, slide_id) or await ai_hidden_on(
        connection, principal, project_id, slide_id
    ):
        raise FirstReadOpenError


async def sees_reviewer(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    reviewer: uuid.UUID | None,
) -> bool:
    me = user_of(principal)
    if reviewer is not None and reviewer == me:
        return True
    if await sees_whole(connection, principal, project_id):
        return True
    if me is None or reviewer is None:
        return False
    submitted = {
        row.user_id: row.submitted_at
        for row in await connection.execute(
            select(review_assignments.c.user_id, review_assignments.c.submitted_at).where(
                review_assignments.c.task_id == task_id,
                review_assignments.c.slide_id == slide_id,
                review_assignments.c.user_id.in_([me, reviewer]),
            )
        )
    }
    if me not in submitted or reviewer not in submitted:
        return False
    if await ai_hidden_on(connection, principal, project_id, slide_id):
        return False
    blinded = await connection.scalar(
        select(review_tasks.c.blinded).where(review_tasks.c.id == task_id)
    )
    return not blinded or submitted[me] is not None


async def require_seeing_reviewer(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    reviewer: uuid.UUID | None,
) -> None:
    if not await sees_reviewer(connection, principal, project_id, task_id, slide_id, reviewer):
        raise OtherReviewerError


async def task_started(connection: AsyncConnection, task_id: uuid.UUID) -> bool:
    moved = select(review_assignments.c.task_id).where(
        review_assignments.c.task_id == task_id,
        or_(
            review_assignments.c.submitted_at.is_not(None),
            review_assignments.c.first_read_at.is_not(None),
        ),
    )
    worked = [
        moved,
        select(verdicts.c.task_id).where(verdicts.c.task_id == task_id),
        select(review_edits.c.task_id).where(review_edits.c.task_id == task_id),
        select(opinions.c.task_id).where(opinions.c.task_id == task_id),
        select(annotations.c.task_id).where(annotations.c.task_id == task_id),
    ]
    for statement in worked:
        if await connection.scalar(select(statement.exists())):
            return True
    return False
