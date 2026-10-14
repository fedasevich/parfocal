import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.tables import CaseState, cases

RESTORE_WINDOW = timedelta(days=30)


class CaseEvent(StrEnum):
    SLIDES_MATCHED = "slides-matched"
    AI_FINISHED = "ai-finished"
    OPENED = "opened"
    SUBTASK_OPENED = "subtask-opened"
    SUBTASKS_CLOSED = "subtasks-closed"
    DRAFT_SAVED = "draft-saved"
    SIGNED_OUT = "signed-out"
    SENT_FOR_REVIEW = "sent-for-review"
    CO_SIGNED = "co-signed"
    RETURNED = "returned"
    AMENDMENT_STARTED = "amendment-started"
    AMENDMENT_SIGNED = "amendment-signed"
    CANCELLED = "cancelled"
    RESTORED = "restored"


class CaseActor(StrEnum):
    SYSTEM = "system"
    ASSIGNEE = "assignee"
    SUPERVISOR = "supervisor"
    SIGNER = "signer"
    LEAD = "lead"


@dataclass(frozen=True)
class Transition:
    sources: frozenset[CaseState]
    target: CaseState | None
    actors: frozenset[CaseActor]


def rule(sources: set[CaseState], target: CaseState | None, actors: set[CaseActor]) -> Transition:
    return Transition(frozenset(sources), target, frozenset(actors))


S = CaseState
A = CaseActor
OPEN_STATES = {
    S.WAITING_FOR_SLIDES,
    S.WAITING_FOR_AI,
    S.READY_TO_REVIEW,
    S.IN_REVIEW,
    S.WAITING_ON_OTHERS,
    S.REPORT_DRAFTED,
    S.WITH_SUPERVISOR,
}

TRANSITIONS: dict[CaseEvent, Transition] = {
    CaseEvent.SLIDES_MATCHED: rule({S.WAITING_FOR_SLIDES}, S.WAITING_FOR_AI, {A.SYSTEM}),
    CaseEvent.AI_FINISHED: rule({S.WAITING_FOR_AI}, S.READY_TO_REVIEW, {A.SYSTEM}),
    CaseEvent.OPENED: rule({S.READY_TO_REVIEW}, S.IN_REVIEW, {A.ASSIGNEE}),
    CaseEvent.SUBTASK_OPENED: rule({S.IN_REVIEW}, S.WAITING_ON_OTHERS, {A.SYSTEM}),
    CaseEvent.SUBTASKS_CLOSED: rule({S.WAITING_ON_OTHERS}, S.IN_REVIEW, {A.SYSTEM}),
    CaseEvent.DRAFT_SAVED: rule({S.IN_REVIEW}, S.REPORT_DRAFTED, {A.ASSIGNEE}),
    CaseEvent.SIGNED_OUT: rule({S.REPORT_DRAFTED}, S.SIGNED, {A.ASSIGNEE}),
    CaseEvent.SENT_FOR_REVIEW: rule({S.REPORT_DRAFTED}, S.WITH_SUPERVISOR, {A.ASSIGNEE}),
    CaseEvent.CO_SIGNED: rule({S.WITH_SUPERVISOR}, S.SIGNED, {A.SUPERVISOR}),
    CaseEvent.RETURNED: rule({S.WITH_SUPERVISOR}, S.IN_REVIEW, {A.SUPERVISOR}),
    CaseEvent.AMENDMENT_STARTED: rule({S.SIGNED}, S.AMENDING, {A.SIGNER, A.LEAD}),
    CaseEvent.AMENDMENT_SIGNED: rule({S.AMENDING}, S.SIGNED, {A.SIGNER, A.LEAD}),
    CaseEvent.CANCELLED: rule(OPEN_STATES, S.CANCELLED, {A.LEAD}),
    CaseEvent.RESTORED: rule({S.CANCELLED}, None, {A.LEAD}),
}

SIGNING_EVENTS = frozenset({CaseEvent.SIGNED_OUT, CaseEvent.CO_SIGNED, CaseEvent.AMENDMENT_SIGNED})
START = S.WAITING_FOR_SLIDES


class WrongStateError(ConflictError):
    code = "case-wrong-state"
    title = "The case is not in a state that allows this"


class WrongActorError(ForbiddenError):
    code = "case-wrong-actor"
    title = "Someone else moves the case on at this point"


class RestoreWindowClosedError(ConflictError):
    code = "case-restore-closed"
    title = "A cancelled case can only be restored within 30 days"


@dataclass(frozen=True)
class CaseStatus:
    state: CaseState
    cancelled_from: CaseState | None = None
    cancelled_at: datetime | None = None


def advance(status: CaseStatus, event: CaseEvent, actor: CaseActor, now: datetime) -> CaseStatus:
    transition = TRANSITIONS[event]
    if status.state not in transition.sources:
        raise WrongStateError
    if actor not in transition.actors:
        raise WrongActorError
    if event is CaseEvent.CANCELLED:
        return CaseStatus(CaseState.CANCELLED, status.state, now)
    if event is CaseEvent.RESTORED:
        assert status.cancelled_from is not None
        assert status.cancelled_at is not None
        if now - status.cancelled_at > RESTORE_WINDOW:
            raise RestoreWindowClosedError
        return CaseStatus(status.cancelled_from)
    assert transition.target is not None
    return CaseStatus(transition.target)


async def move_case(
    connection: AsyncConnection,
    principal: Principal,
    case_id: uuid.UUID,
    event: CaseEvent,
    actor: CaseActor,
) -> CaseStatus:
    row = (
        await connection.execute(
            select(cases.c.state, cases.c.cancelled_from, cases.c.cancelled_at, func.now())
            .where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Case not found")
    before = CaseStatus(
        CaseState(row.state),
        CaseState(row.cancelled_from) if row.cancelled_from else None,
        row.cancelled_at,
    )
    after = advance(before, event, actor, row.now)
    await connection.execute(
        update(cases)
        .where(cases.c.id == case_id)
        .values(
            state=after.state,
            cancelled_from=after.cancelled_from,
            cancelled_at=after.cancelled_at,
            state_changed_at=func.now(),
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_STATE_CHANGED,
        AuditTarget.CASE,
        case_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"event": event, "from": before.state, "to": after.state, "as": actor},
    )
    return after


class CaseStateView(BaseModel):
    id: uuid.UUID
    state: CaseState


router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.post(
    "/{case_id}/cancel",
    operation_id="cancelCase",
    **require(Permission.CANCEL_CASES, write=True),
)
async def cancel_case(
    case_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> CaseStateView:
    after = await move_case(connection, principal, case_id, CaseEvent.CANCELLED, CaseActor.LEAD)
    return CaseStateView(id=case_id, state=after.state)


@router.post(
    "/{case_id}/restore",
    operation_id="restoreCase",
    **require(Permission.CANCEL_CASES, write=True),
)
async def restore_case(
    case_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> CaseStateView:
    after = await move_case(connection, principal, case_id, CaseEvent.RESTORED, CaseActor.LEAD)
    return CaseStateView(id=case_id, state=after.state)
