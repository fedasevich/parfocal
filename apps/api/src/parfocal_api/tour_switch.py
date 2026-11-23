import uuid
from dataclasses import dataclass
from typing import Any, Literal, cast

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.auth import (
    AUTH_SCOPE,
    SESSION_COOKIE,
    TOUR_ORIGIN,
    auth_state,
    digest,
    load_session,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import ActorKind, memberships, sessions, users
from parfocal_common.db import scoped_transaction

TourAccount = Literal[
    "researcher", "reviewer-a", "reviewer-b", "adjudicator", "viewer", "annotator"
]
ROLE_ACCOUNT_DOMAIN = "parfocal.eu"


def role_account_email(account: TourAccount) -> str:
    return f"role-{account}@{ROLE_ACCOUNT_DOMAIN}"


class TourSwitchOffError(NotFoundError):
    code = "tour-switch-off"
    title = "Switching account for the tour is off on this server"


class NoRoleAccountError(NotFoundError):
    code = "no-role-account"
    title = "This workspace has no such role account"


class NoTourOriginError(NotFoundError):
    code = "no-tour-origin"
    title = "This session did not start a tour switch"


class NeedsBrowserSessionError(ConflictError):
    code = "needs-browser-session"
    title = "Switching account needs a signed-in browser session"


class AlreadySwitchedError(ConflictError):
    code = "tour-already-switched"
    title = "Return to your own account before switching again"


class TourSwitch(BaseModel):
    account: TourAccount


class TourAccountShown(BaseModel):
    name: str
    email: str
    switched: bool


@dataclass(frozen=True)
class Target:
    subject: str
    name: str
    email: str


@dataclass(frozen=True)
class Origin:
    subject: str
    name: str | None
    email: str | None


def text_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def origin_of(tokens: dict[str, Any]) -> Origin | None:
    held: object = tokens.get(TOUR_ORIGIN)
    if not isinstance(held, dict):
        return None
    fields = cast("dict[str, object]", held)
    subject = text_or_none(fields.get("subject"))
    if subject is None:
        return None
    return Origin(subject, text_or_none(fields.get("name")), text_or_none(fields.get("email")))


router = APIRouter(prefix="/api/tour", tags=["tour"])


def switch_on(request: Request) -> None:
    settings = cast("ApiSettings", request.app.settings)
    if not settings.tour_role_switch:
        raise TourSwitchOffError


async def role_account_in(
    connection: AsyncConnection, tenant_id: uuid.UUID, account: TourAccount
) -> Target:
    address = role_account_email(account)
    row = (
        await connection.execute(
            select(users.c.subject, users.c.display_name, users.c.email)
            .join(memberships, memberships.c.user_id == users.c.id)
            .where(
                func.lower(users.c.email) == address,
                memberships.c.tenant_id == tenant_id,
                memberships.c.deactivated_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        raise NoRoleAccountError
    return Target(row.subject, row.display_name or address, address)


async def swap_session(request: Request, origin_subject: str, target: Target) -> None:
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise NeedsBrowserSessionError
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        loaded = await load_session(connection, state, session_id, for_update=True)
        if loaded is None or loaded["row"].subject != origin_subject:
            raise NeedsBrowserSessionError
        tokens: dict[str, Any] = loaded["tokens"]
        if TOUR_ORIGIN in tokens:
            raise AlreadySwitchedError
        origin = {
            "subject": origin_subject,
            "name": tokens.get("name"),
            "email": tokens.get("email"),
        }
        sealed = tokens | {TOUR_ORIGIN: origin, "name": target.name, "email": target.email}
        await connection.execute(
            update(sessions)
            .where(sessions.c.id_hash == digest(session_id))
            .values(subject=target.subject, tokens=state.cipher.seal(sealed))
        )


@router.post(
    "/role-switch",
    operation_id="switchToTourRole",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def switch_to_tour_role(
    switch: TourSwitch,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TourAccountShown:
    switch_on(request)
    if not isinstance(principal, MemberPrincipal):
        raise ForbiddenError
    target = await role_account_in(connection, principal.tenant_id, switch.account)
    await swap_session(request, principal.subject, target)
    await record(
        connection,
        Actor(ActorKind.MEMBER, principal.subject),
        AuditAction.TOUR_ROLE_SWITCHED,
        AuditTarget.PERSON,
        person=target.subject,
        tenant_id=principal.tenant_id,
        details={"account": switch.account},
    )
    return TourAccountShown(name=target.name, email=target.email, switched=True)


@router.delete("/role-switch", operation_id="returnFromTourRole")
async def return_from_tour_role(
    request: Request, principal: CurrentPrincipal, tenant: TenantConnection
) -> TourAccountShown:
    switch_on(request)
    if not isinstance(principal, MemberPrincipal):
        raise NoTourOriginError
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise NoTourOriginError
    state = auth_state(request)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        loaded = await load_session(connection, state, session_id, for_update=True)
        if loaded is None or loaded["row"].subject != principal.subject:
            raise NoTourOriginError
        tokens: dict[str, Any] = loaded["tokens"]
        origin = origin_of(tokens)
        if origin is None:
            raise NoTourOriginError
        known = await connection.scalar(select(users.c.id).where(users.c.subject == origin.subject))
        if known is None:
            raise NoTourOriginError
        restored = {key: value for key, value in tokens.items() if key != TOUR_ORIGIN}
        restored |= {"name": origin.name, "email": origin.email}
        await connection.execute(
            update(sessions)
            .where(sessions.c.id_hash == digest(session_id))
            .values(subject=origin.subject, tokens=state.cipher.seal(restored))
        )
    await record(
        tenant,
        Actor(ActorKind.MEMBER, origin.subject),
        AuditAction.TOUR_ROLE_RETURNED,
        AuditTarget.PERSON,
        person=principal.subject,
        tenant_id=principal.tenant_id,
    )
    return TourAccountShown(name=origin.name or "", email=origin.email or "", switched=False)
