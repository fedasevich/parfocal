import uuid
from datetime import datetime
from typing import Any

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.auth import (
    AUTH_SCOPE,
    SESSION_COOKIE,
    AuthState,
    auth_state,
    digest,
    now,
    session_limits,
)
from parfocal_api.context import CurrentPrincipal
from parfocal_api.oidc import IdentityError
from parfocal_api.problems import NotFoundError
from parfocal_api.tables import ActorKind, sessions
from parfocal_api.users import signed_in
from parfocal_common.db import scoped_transaction

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SessionSummary(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    active_at: datetime
    expires_at: datetime
    user_agent: str | None
    current: bool
    locked: bool


class EndedSessions(BaseModel):
    ended: int


def current_hash(request: Request) -> bytes:
    return digest(request.cookies.get(SESSION_COOKIE, ""))


async def revoke_all(state: AuthState, sealed: list[bytes]) -> None:
    for value in sealed:
        try:
            tokens: dict[str, Any] = state.cipher.open(value)
            await state.identity.revoke(str(tokens["refresh_token"]))
        except InvalidTag, IdentityError, KeyError:
            continue


@router.get("/sessions", operation_id="listSessions")
async def list_sessions(request: Request, principal: CurrentPrincipal) -> list[SessionSummary]:
    person = signed_in(principal)
    state = auth_state(request)
    mine = current_hash(request)
    summaries: list[SessionSummary] = []
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        rows = await connection.execute(
            select(sessions)
            .where(sessions.c.subject == person.subject, sessions.c.expires_at > func.now())
            .order_by(sessions.c.created_at)
        )
        for row in rows.all():
            limits = await session_limits(connection, row.active_tenant_id)
            summaries.append(
                SessionSummary(
                    id=row.id,
                    created_at=row.created_at,
                    last_seen_at=row.last_seen_at,
                    active_at=row.active_at,
                    expires_at=row.expires_at,
                    user_agent=row.user_agent,
                    current=row.id_hash == mine,
                    locked=row.active_at + limits.idle <= now(),
                )
            )
    return summaries


@router.post("/activity", operation_id="recordActivity", status_code=204, response_class=Response)
async def record_activity(request: Request, principal: CurrentPrincipal) -> None:
    signed_in(principal)
    async with scoped_transaction(auth_state(request).engine, AUTH_SCOPE) as connection:
        await connection.execute(
            sessions.update()
            .where(sessions.c.id_hash == current_hash(request))
            .values(active_at=func.now())
        )


@router.delete(
    "/sessions/{session_id}", operation_id="endSession", status_code=204, response_class=Response
)
async def end_session(session_id: uuid.UUID, request: Request, principal: CurrentPrincipal) -> None:
    person = signed_in(principal)
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        sealed = await connection.scalar(
            delete(sessions)
            .where(sessions.c.id == session_id, sessions.c.subject == person.subject)
            .returning(sessions.c.tokens)
        )
        if sealed is None:
            raise NotFoundError("Session not found")
        await record(
            connection,
            Actor(ActorKind.USER, person.subject),
            AuditAction.SESSIONS_ENDED,
            AuditTarget.PERSON,
            person=person.subject,
            details={"count": 1},
        )
    await revoke_all(state, [sealed])


@router.post("/sessions/end-others", operation_id="endOtherSessions")
async def end_other_sessions(request: Request, principal: CurrentPrincipal) -> EndedSessions:
    person = signed_in(principal)
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        ended = await connection.scalars(
            delete(sessions)
            .where(
                sessions.c.subject == person.subject, sessions.c.id_hash != current_hash(request)
            )
            .returning(sessions.c.tokens)
        )
        sealed = list(ended.all())
        if sealed:
            await record(
                connection,
                Actor(ActorKind.USER, person.subject),
                AuditAction.SESSIONS_ENDED,
                AuditTarget.PERSON,
                person=person.subject,
                details={"count": len(sealed)},
            )
    await revoke_all(state, sealed)
    return EndedSessions(ended=len(sealed))
