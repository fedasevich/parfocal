import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any, Self

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, model_validator
from sqlalchemy import delete, exists, func, insert, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import AUTH_SCOPE, auth_state
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.retention import SYSTEM
from parfocal_api.review_tasks import check_reviewers, task_row
from parfocal_api.sessions_api import revoke_all
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import (
    ProjectRole,
    ReassignWhat,
    adjudication_objects,
    adjudications,
    disagreement_decisions,
    memberships,
    project_members,
    review_assignments,
    review_tasks,
    sessions,
    task_reassignments,
    tenants,
    threads,
    users,
)
from parfocal_api.task_changes import live_rows, place, remove, started_slides
from parfocal_api.users import LastAdminError
from parfocal_common.db import (
    CURRENT_TENANT,
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.jobs import PLATFORM
from parfocal_common.settings import load_settings

router = APIRouter(prefix="/api/tenant", tags=["tenant"])


class OpenWorkKind(StrEnum):
    REVIEW_SLIDES = "review-slides"
    OWNED_TASK = "owned-task"
    ADJUDICATION = "adjudication"
    OPEN_THREAD = "open-thread"


class HandoverAction(StrEnum):
    REASSIGN = "reassign"
    RETURN = "return"


class DeactivationState(StrEnum):
    DEACTIVATED = "deactivated"
    SCHEDULED = "scheduled"


class OpenWorkItem(BaseModel):
    kind: OpenWorkKind
    id: uuid.UUID
    task_id: uuid.UUID | None
    label: str
    count: int


class OpenWork(BaseModel):
    user_id: uuid.UUID
    items: list[OpenWorkItem]


class Handover(BaseModel):
    kind: OpenWorkKind
    id: uuid.UUID
    action: HandoverAction
    to_user_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def reassign_names_a_person(self) -> Self:
        if self.action is HandoverAction.REASSIGN and self.to_user_id is None:
            raise ValueError("A reassign names the person who takes it over")
        return self


class DeactivationDraft(BaseModel):
    ends_on: date | None = None
    handovers: list[Handover] = []


class Deactivation(BaseModel):
    user_id: uuid.UUID
    state: DeactivationState
    ends_on: date | None
    handed_over: int


class OpenWorkRemainsError(ConflictError):
    code = "open-work"
    title = "Hand over or return every open item before deactivating this person"


class OwnDeactivationError(ConflictError):
    code = "own-deactivation"
    title = "Ask another admin to deactivate you"


class AlreadyDeactivatedError(ConflictError):
    code = "already-deactivated"
    title = "This person is already deactivated"


class EndDateInThePastError(BadRequestError):
    code = "end-date-in-the-past"
    title = "The end date must be today or later"


class NotOpenWorkError(BadRequestError):
    code = "not-open-work"
    title = "That item is not open work of this person"


class CannotTakeOverError(BadRequestError):
    code = "cannot-take-over"
    title = "That person cannot take this over"


class NothingScheduledError(NotFoundError):
    code = "no-scheduled-deactivation"
    title = "This person has no scheduled deactivation"


@dataclass(frozen=True)
class Leaver:
    user_id: uuid.UUID
    subject: str
    tenant_id: uuid.UUID


def utc_today() -> date:
    return datetime.now(UTC).date()


def unfinished_task() -> tuple[Any, ...]:
    return (review_tasks.c.archived_at.is_(None), review_tasks.c.signed_off_at.is_(None))


async def open_work_of(connection: AsyncConnection, user_id: uuid.UUID) -> list[OpenWorkItem]:
    items: list[OpenWorkItem] = []
    slides = await connection.execute(
        select(review_tasks.c.id, review_tasks.c.name, func.count().label("slides"))
        .join(review_assignments, review_assignments.c.task_id == review_tasks.c.id)
        .where(
            review_assignments.c.user_id == user_id,
            review_assignments.c.released_at.is_(None),
            review_assignments.c.submitted_at.is_(None),
            *unfinished_task(),
        )
        .group_by(review_tasks.c.id, review_tasks.c.name, review_tasks.c.number)
        .order_by(review_tasks.c.number)
    )
    items += [
        OpenWorkItem(
            kind=OpenWorkKind.REVIEW_SLIDES,
            id=row.id,
            task_id=row.id,
            label=row.name,
            count=row.slides,
        )
        for row in slides
    ]
    owned = await connection.execute(
        select(review_tasks.c.id, review_tasks.c.name)
        .where(review_tasks.c.created_by_user_id == user_id, *unfinished_task())
        .order_by(review_tasks.c.number)
    )
    items += [
        OpenWorkItem(
            kind=OpenWorkKind.OWNED_TASK, id=row.id, task_id=row.id, label=row.name, count=1
        )
        for row in owned
    ]
    undecided = ~exists().where(
        disagreement_decisions.c.task_id == adjudication_objects.c.task_id,
        disagreement_decisions.c.slide_id == adjudication_objects.c.slide_id,
        disagreement_decisions.c.kind == adjudication_objects.c.kind,
        disagreement_decisions.c.number == adjudication_objects.c.number,
        disagreement_decisions.c.decided_by_user_id == user_id,
    )
    sent = await connection.execute(
        select(adjudications.c.id, adjudications.c.task_id, review_tasks.c.name, func.count())
        .join(review_tasks, review_tasks.c.id == adjudications.c.task_id)
        .join(adjudication_objects, adjudication_objects.c.adjudication_id == adjudications.c.id)
        .where(
            adjudications.c.adjudicator_user_id == user_id,
            adjudications.c.declined_at.is_(None),
            undecided,
            *unfinished_task(),
        )
        .group_by(adjudications.c.id, adjudications.c.task_id, review_tasks.c.name)
        .order_by(adjudications.c.sent_at, adjudications.c.id)
    )
    items += [
        OpenWorkItem(
            kind=OpenWorkKind.ADJUDICATION,
            id=row.id,
            task_id=row.task_id,
            label=row.name,
            count=row[3],
        )
        for row in sent
    ]
    open_threads = await connection.execute(
        select(threads.c.id, threads.c.task_id, threads.c.title)
        .where(threads.c.created_by_user_id == user_id, threads.c.resolved_at.is_(None))
        .order_by(threads.c.created_at, threads.c.id)
    )
    items += [
        OpenWorkItem(
            kind=OpenWorkKind.OPEN_THREAD,
            id=row.id,
            task_id=row.task_id,
            label=row.title,
            count=1,
        )
        for row in open_threads
    ]
    return items


async def successor(
    connection: AsyncConnection, leaver: Leaver, handover: Handover, project_id: uuid.UUID | None
) -> uuid.UUID:
    assert handover.to_user_id is not None
    if handover.to_user_id == leaver.user_id:
        raise CannotTakeOverError
    active = await connection.scalar(
        select(
            exists().where(
                memberships.c.user_id == handover.to_user_id,
                memberships.c.tenant_id == literal_column(CURRENT_TENANT),
                memberships.c.deactivated_at.is_(None),
                memberships.c.deactivates_on.is_(None),
            )
        )
    )
    if not active:
        raise CannotTakeOverError
    if project_id is not None:
        await check_reviewers(connection, project_id, [handover.to_user_id])
    return handover.to_user_id


async def hand_over_slides(
    connection: AsyncConnection,
    leaver: Leaver,
    handover: Handover,
) -> int:
    row = await task_row(connection, handover.id)
    live = await live_rows(connection, row.id, leaver.user_id)
    pending = [slide.slide_id for slide in live if slide.submitted_at is None]
    started = await started_slides(connection, row.id, leaver.user_id)
    kept = [slide for slide in pending if slide in started]
    untouched = [slide for slide in pending if slide not in started]
    if handover.action is HandoverAction.REASSIGN:
        to_user_id = await successor(connection, leaver, handover, row.project_id)
        await place(connection, row, to_user_id, pending)
        await connection.execute(
            insert(task_reassignments).values(
                tenant_id=row.tenant_id,
                task_id=row.id,
                from_user_id=leaver.user_id,
                to_user_id=to_user_id,
                what=ReassignWhat.ALL,
                slide_ids=pending,
                kept_slide_ids=kept,
            )
        )
    if kept:
        await connection.execute(
            update(review_assignments)
            .where(
                review_assignments.c.task_id == row.id,
                review_assignments.c.user_id == leaver.user_id,
                review_assignments.c.slide_id.in_(kept),
            )
            .values(released_at=func.now())
        )
    await remove(connection, row, leaver.user_id, untouched)
    return len(pending)


async def hand_over_task(connection: AsyncConnection, leaver: Leaver, handover: Handover) -> int:
    row = await task_row(connection, handover.id)
    new_owner: uuid.UUID | None = None
    if handover.action is HandoverAction.REASSIGN:
        new_owner = await successor(connection, leaver, handover, None)
        owns = await connection.scalar(
            select(
                exists().where(
                    project_members.c.project_id == row.project_id,
                    project_members.c.user_id == new_owner,
                    project_members.c.role == ProjectRole.OWNER,
                )
            )
        )
        if not owns:
            raise CannotTakeOverError
    await connection.execute(
        update(review_tasks).where(review_tasks.c.id == row.id).values(created_by_user_id=new_owner)
    )
    return 1


async def hand_over_adjudication(
    connection: AsyncConnection, leaver: Leaver, handover: Handover
) -> int:
    if handover.action is HandoverAction.REASSIGN:
        task_id = await connection.scalar(
            select(adjudications.c.task_id).where(adjudications.c.id == handover.id)
        )
        project_id = await connection.scalar(
            select(review_tasks.c.project_id).where(review_tasks.c.id == task_id)
        )
        to_user_id = await successor(connection, leaver, handover, project_id)
        await connection.execute(
            update(adjudications)
            .where(adjudications.c.id == handover.id)
            .values(adjudicator_user_id=to_user_id)
        )
    else:
        await connection.execute(
            update(adjudications)
            .where(adjudications.c.id == handover.id)
            .values(declined_at=func.now())
        )
    return 1


async def hand_over_thread(
    connection: AsyncConnection, leaver: Leaver, handover: Handover, by_user_id: uuid.UUID
) -> int:
    if handover.action is HandoverAction.REASSIGN:
        raise CannotTakeOverError
    await connection.execute(
        update(threads)
        .where(threads.c.id == handover.id)
        .values(resolved_at=func.now(), resolved_by_user_id=by_user_id)
    )
    return 1


async def hand_over(
    connection: AsyncConnection,
    actor: Actor,
    leaver: Leaver,
    handover: Handover,
    by_user_id: uuid.UUID,
) -> int:
    match handover.kind:
        case OpenWorkKind.REVIEW_SLIDES:
            moved = await hand_over_slides(connection, leaver, handover)
        case OpenWorkKind.OWNED_TASK:
            moved = await hand_over_task(connection, leaver, handover)
        case OpenWorkKind.ADJUDICATION:
            moved = await hand_over_adjudication(connection, leaver, handover)
        case OpenWorkKind.OPEN_THREAD:
            moved = await hand_over_thread(connection, leaver, handover, by_user_id)
    await record(
        connection,
        actor,
        AuditAction.MEMBER_HANDED_OVER,
        AuditTarget.PERSON,
        person=leaver.subject,
        tenant_id=leaver.tenant_id,
        details={"kind": handover.kind.value, "action": handover.action.value, "count": moved},
    )
    return moved


async def end_sessions(
    engine: AsyncEngine, subjects: list[str], tenant_id: uuid.UUID
) -> list[bytes]:
    if not subjects:
        return []
    async with scoped_transaction(engine, AUTH_SCOPE) as connection:
        ended = await connection.scalars(
            delete(sessions)
            .where(sessions.c.subject.in_(subjects), sessions.c.active_tenant_id == tenant_id)
            .returning(sessions.c.tokens)
        )
        return list(ended.all())


async def deactivate_now(
    connection: AsyncConnection, actor: Actor, leaver: Leaver, scheduled: bool
) -> None:
    await connection.execute(
        update(memberships)
        .where(memberships.c.tenant_id == leaver.tenant_id, memberships.c.user_id == leaver.user_id)
        .values(deactivated_at=func.now())
    )
    await record(
        connection,
        actor,
        AuditAction.MEMBER_DEACTIVATED,
        AuditTarget.PERSON,
        person=leaver.subject,
        tenant_id=leaver.tenant_id,
        details={"scheduled": scheduled},
    )


@router.get(
    "/members/{user_id}/open-work",
    operation_id="getMemberOpenWork",
    **require(Permission.MANAGE_PEOPLE),
)
async def get_member_open_work(user_id: uuid.UUID, connection: TenantConnection) -> OpenWork:
    found = await connection.scalar(
        select(
            exists().where(
                memberships.c.user_id == user_id,
                memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            )
        )
    )
    if not found:
        raise NotFoundError("Member not found")
    return OpenWork(user_id=user_id, items=await open_work_of(connection, user_id))


@router.post(
    "/members/{user_id}/deactivation",
    operation_id="deactivateMember",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def deactivate_member(
    user_id: uuid.UUID,
    draft: DeactivationDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Deactivation:
    assert isinstance(principal, MemberPrincipal)
    if principal.user_id == user_id:
        raise OwnDeactivationError
    tenant_id = principal.tenant_id
    locked = (
        await connection.execute(
            select(
                memberships.c.user_id,
                memberships.c.admin_rights,
                memberships.c.deactivated_at,
                users.c.subject,
            )
            .join(users, users.c.id == memberships.c.user_id)
            .where(
                memberships.c.tenant_id == tenant_id,
                memberships.c.deactivated_at.is_(None),
            )
            .order_by(memberships.c.id)
            .with_for_update(of=memberships)
        )
    ).all()
    member = next((row for row in locked if row.user_id == user_id), None)
    if member is None:
        already = await connection.scalar(
            select(
                exists().where(
                    memberships.c.user_id == user_id, memberships.c.tenant_id == tenant_id
                )
            )
        )
        if already:
            raise AlreadyDeactivatedError
        raise NotFoundError("Member not found")
    if member.admin_rights and sum(row.admin_rights for row in locked) == 1:
        raise LastAdminError
    today = utc_today()
    if draft.ends_on is not None and draft.ends_on < today:
        raise EndDateInThePastError
    leaver = Leaver(user_id, member.subject, tenant_id)
    work = await open_work_of(connection, user_id)
    given = {(item.kind, item.id): item for item in draft.handovers}
    known = {(item.kind, item.id) for item in work}
    if not set(given) <= known:
        raise NotOpenWorkError
    uncovered = [item for item in work if (item.kind, item.id) not in given]
    if uncovered:
        error = OpenWorkRemainsError()
        error.current = {"items": [item.model_dump(mode="json") for item in uncovered]}
        raise error
    actor = actor_of(principal)
    handed_over = 0
    for handover in given.values():
        handed_over += await hand_over(connection, actor, leaver, handover, principal.user_id)
    scheduled = draft.ends_on is not None and draft.ends_on > today
    if scheduled:
        await connection.execute(
            update(memberships)
            .where(memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id)
            .values(deactivates_on=draft.ends_on)
        )
        await record(
            connection,
            actor,
            AuditAction.MEMBER_DEACTIVATION_SCHEDULED,
            AuditTarget.PERSON,
            person=member.subject,
            tenant_id=tenant_id,
            details={"ends_on": draft.ends_on.isoformat() if draft.ends_on else None},
        )
        return Deactivation(
            user_id=user_id,
            state=DeactivationState.SCHEDULED,
            ends_on=draft.ends_on,
            handed_over=handed_over,
        )
    await connection.execute(
        update(memberships)
        .where(memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id)
        .values(deactivates_on=None)
    )
    await deactivate_now(connection, actor, leaver, scheduled=False)
    state = auth_state(request)
    await revoke_all(state, await end_sessions(state.engine, [member.subject], tenant_id))
    return Deactivation(
        user_id=user_id,
        state=DeactivationState.DEACTIVATED,
        ends_on=None,
        handed_over=handed_over,
    )


@router.delete(
    "/members/{user_id}/deactivation",
    operation_id="cancelMemberDeactivation",
    status_code=204,
    response_class=Response,
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def cancel_member_deactivation(
    user_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    assert isinstance(principal, MemberPrincipal)
    tenant_id = principal.tenant_id
    cancelled = (
        await connection.execute(
            update(memberships)
            .where(
                memberships.c.tenant_id == tenant_id,
                memberships.c.user_id == user_id,
                memberships.c.deactivates_on.is_not(None),
                memberships.c.deactivated_at.is_(None),
            )
            .values(deactivates_on=None)
            .returning(memberships.c.user_id)
        )
    ).first()
    if cancelled is None:
        raise NothingScheduledError
    subject = await connection.scalar(select(users.c.subject).where(users.c.id == user_id))
    await record(
        connection,
        actor_of(principal),
        AuditAction.MEMBER_DEACTIVATION_CANCELLED,
        AuditTarget.PERSON,
        person=subject,
        tenant_id=tenant_id,
    )


async def finish_due_deactivations(
    engine: AsyncEngine, today: date, revoke: Any = None
) -> list[uuid.UUID]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    finished: list[uuid.UUID] = []
    for tenant_id in tenant_ids:
        subjects: list[str] = []
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            due = (
                await connection.execute(
                    select(memberships.c.user_id, users.c.subject)
                    .join(users, users.c.id == memberships.c.user_id)
                    .where(
                        memberships.c.tenant_id == tenant_id,
                        memberships.c.deactivates_on <= today,
                        memberships.c.deactivated_at.is_(None),
                    )
                    .order_by(memberships.c.id)
                    .with_for_update(of=memberships, skip_locked=True)
                )
            ).all()
            for row in due:
                leaver = Leaver(row.user_id, row.subject, tenant_id)
                for item in await open_work_of(connection, row.user_id):
                    returned = Handover(kind=item.kind, id=item.id, action=HandoverAction.RETURN)
                    await hand_over(connection, SYSTEM, leaver, returned, row.user_id)
                await deactivate_now(connection, SYSTEM, leaver, scheduled=True)
                subjects.append(row.subject)
                finished.append(row.user_id)
        sealed = await end_sessions(engine, subjects, tenant_id)
        if revoke is not None:
            await revoke(sealed)
    return finished


async def run_once(settings: ApiSettings) -> int:
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        return len(await finish_due_deactivations(engine, utc_today()))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_once(load_settings(ApiSettings)))
