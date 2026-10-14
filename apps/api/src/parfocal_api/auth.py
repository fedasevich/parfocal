import base64
import hashlib
import html
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, cast

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete, exists, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.oidc import IdentityError, OidcClient, TokenSet
from parfocal_api.principals import (
    MemberPrincipal,
    PlatformOperator,
    Principal,
    ServicePrincipal,
    SignedInUser,
)
from parfocal_api.problems import ForbiddenError, ProblemError, UnauthenticatedError
from parfocal_api.tables import (
    AVATAR_COLOURS,
    DEFAULT_IDLE_LOCK_MINUTES,
    DEFAULT_SESSION_HOURS,
    ActorKind,
    Role,
    api_tokens,
    auth_logins,
    memberships,
    platform_operators,
    service_accounts,
    session_policies,
    sessions,
    users,
)
from parfocal_common.db import DatabaseScope, scoped_transaction

SESSION_COOKIE = "__Host-parfocal_session"
LOGIN_COOKIE = "__Host-parfocal_login"
LOGIN_LIFETIME = timedelta(minutes=10)
USER_AGENT_LENGTH = 200
REFRESH_MARGIN = timedelta(seconds=30)
SEEN_INTERVAL = timedelta(minutes=1)
AUTH_SCOPE = DatabaseScope(auth=True)
API_TOKEN_PREFIX = "pf_"


class LoginFailedError(ProblemError):
    status = 400
    code = "login-failed"
    title = "Signing in did not work, try again"


class SessionKeyError(ValueError):
    def __init__(self) -> None:
        super().__init__("SESSION_KEY must be 32 bytes encoded as URL-safe base64")


class SessionCipher:
    def __init__(self, key: str) -> None:
        try:
            raw = base64.urlsafe_b64decode(key.encode())
        except ValueError as error:
            raise SessionKeyError from error
        if len(raw) != 32:
            raise SessionKeyError
        self._aead = AESGCM(raw)

    def seal(self, value: dict[str, Any]) -> bytes:
        nonce = secrets.token_bytes(12)
        return nonce + self._aead.encrypt(nonce, json.dumps(value).encode(), None)

    def open(self, sealed: bytes) -> dict[str, Any]:
        opened: dict[str, Any] = json.loads(self._aead.decrypt(sealed[:12], sealed[12:], None))
        return opened


@dataclass(frozen=True)
class AuthState:
    engine: AsyncEngine
    identity: OidcClient
    cipher: SessionCipher
    public_origin: str


class Session(BaseModel):
    subject: str
    name: str | None
    email: str | None
    operator: bool


def auth_state(request: Request) -> AuthState:
    return cast("AuthState", request.app.state.auth)


def digest(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def code_challenge(verifier: str) -> str:
    return (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )


def safe_return_path(value: str) -> str:
    if not value.startswith("/") or value.startswith(("//", "/\\")) or "\\" in value:
        return "/"
    if any(ord(character) < 0x20 for character in value):
        return "/"
    return value


def now() -> datetime:
    return datetime.now(UTC)


def sealed_tokens(tokens: TokenSet, claims: dict[str, Any]) -> dict[str, Any]:
    return {
        "id_token": tokens.id_token,
        "refresh_token": tokens.refresh_token,
        "name": claims.get("name"),
        "email": claims.get("email"),
    }


async def load_session(
    connection: AsyncConnection, state: AuthState, session_id: str
) -> dict[str, Any] | None:
    row = (
        await connection.execute(
            select(sessions)
            .where(sessions.c.id_hash == digest(session_id), sessions.c.expires_at > func.now())
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        return None
    try:
        tokens = state.cipher.open(row.tokens)
    except InvalidTag:
        return None
    return {"row": row, "tokens": tokens}


async def refresh_session(
    connection: AsyncConnection, state: AuthState, session_id: str, tokens: dict[str, Any]
) -> bool:
    try:
        renewed = await state.identity.refresh(str(tokens["refresh_token"]))
        claims = await state.identity.verify_id_token(renewed.id_token, None)
    except IdentityError:
        await connection.execute(delete(sessions).where(sessions.c.id_hash == digest(session_id)))
        return False
    await connection.execute(
        update(sessions)
        .where(sessions.c.id_hash == digest(session_id))
        .values(
            tokens=state.cipher.seal(sealed_tokens(renewed, claims)),
            access_expires_at=now() + timedelta(seconds=renewed.expires_in),
        )
    )
    return True


@dataclass(frozen=True)
class Resolved:
    subject: str
    user_id: uuid.UUID | None
    active_tenant_id: uuid.UUID | None
    operator: bool
    role: Role | None


async def resolve(
    connection: AsyncConnection, subject: str, active_tenant_id: uuid.UUID | None
) -> Resolved:
    user_id = await connection.scalar(select(users.c.id).where(users.c.subject == subject))
    operator = bool(
        await connection.scalar(select(exists().where(platform_operators.c.subject == subject)))
    )
    role = None
    if user_id is not None and active_tenant_id is not None:
        role = await connection.scalar(
            select(memberships.c.role).where(
                memberships.c.user_id == user_id, memberships.c.tenant_id == active_tenant_id
            )
        )
    return Resolved(subject, user_id, active_tenant_id, operator, Role(role) if role else None)


def principal_of(resolved: Resolved) -> Principal:
    if resolved.operator:
        return PlatformOperator(resolved.subject)
    if resolved.user_id is None:
        raise UnauthenticatedError
    if resolved.role is not None and resolved.active_tenant_id is not None:
        return MemberPrincipal(
            resolved.subject, resolved.active_tenant_id, resolved.user_id, resolved.role
        )
    return SignedInUser(resolved.subject, resolved.user_id)


async def service_principal(state: AuthState, token: str) -> ServicePrincipal:
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        row = (
            await connection.execute(
                select(
                    api_tokens.c.id,
                    api_tokens.c.last_used_at,
                    service_accounts.c.id.label("account_id"),
                    service_accounts.c.tenant_id,
                    service_accounts.c.scopes,
                )
                .join(service_accounts, service_accounts.c.id == api_tokens.c.service_account_id)
                .where(
                    api_tokens.c.token_hash == digest(token),
                    api_tokens.c.revoked_at.is_(None),
                    api_tokens.c.expires_at > func.now(),
                    service_accounts.c.disabled_at.is_(None),
                )
            )
        ).one_or_none()
        if row is None:
            raise UnauthenticatedError
        if row.last_used_at is None or row.last_used_at + SEEN_INTERVAL <= now():
            await connection.execute(
                update(api_tokens).where(api_tokens.c.id == row.id).values(last_used_at=func.now())
            )
    return ServicePrincipal(row.account_id, row.tenant_id, frozenset(row.scopes))


class SessionLockedError(UnauthenticatedError):
    code = "session-locked"
    title = "Your session is locked. Sign in again to continue"


@dataclass(frozen=True)
class SessionLimits:
    idle: timedelta
    lifetime: timedelta


async def session_limits(connection: AsyncConnection, tenant_id: uuid.UUID | None) -> SessionLimits:
    row = (
        await connection.execute(
            select(session_policies.c.idle_lock_minutes, session_policies.c.session_hours).where(
                session_policies.c.tenant_id == tenant_id
            )
        )
    ).one_or_none()
    minutes = row.idle_lock_minutes if row else DEFAULT_IDLE_LOCK_MINUTES
    hours = row.session_hours if row else DEFAULT_SESSION_HOURS
    return SessionLimits(timedelta(minutes=minutes), timedelta(hours=hours))


async def authenticate(request: Request) -> Principal:
    authorization = request.headers.get("authorization")
    if authorization is not None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.startswith(API_TOKEN_PREFIX):
            raise UnauthenticatedError
        return await service_principal(auth_state(request), token)
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise UnauthenticatedError
    state = auth_state(request)
    resolved: Resolved | None = None
    locked = False
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        loaded = await load_session(connection, state, session_id)
        if loaded is not None:
            row = loaded["row"]
            alive = True
            limits = await session_limits(connection, row.active_tenant_id)
            if row.created_at + limits.lifetime <= now():
                await connection.execute(
                    delete(sessions).where(sessions.c.id_hash == digest(session_id))
                )
                alive = False
            elif row.active_at + limits.idle <= now():
                locked = True
                alive = False
            elif row.access_expires_at - REFRESH_MARGIN <= now():
                alive = await refresh_session(connection, state, session_id, loaded["tokens"])
            elif row.last_seen_at + SEEN_INTERVAL <= now():
                await connection.execute(
                    update(sessions)
                    .where(sessions.c.id_hash == digest(session_id))
                    .values(last_seen_at=func.now())
                )
            if alive:
                resolved = await resolve(connection, str(row.subject), row.active_tenant_id)
    if locked:
        raise SessionLockedError
    if resolved is None:
        raise UnauthenticatedError
    return principal_of(resolved)


def initials_of(name: str) -> str:
    letters = [word[0] for word in name.split() if word[:1].isalpha()]
    picked = letters[0] + letters[-1] if len(letters) > 1 else "".join(letters[:1])
    initials = "".join(letter for letter in picked.upper() if "A" <= letter <= "Z")
    return initials or "U"


def avatar_colour_of(subject: str) -> int:
    return hashlib.sha256(subject.encode()).digest()[0] % AVATAR_COLOURS


async def sign_in_user(connection: AsyncConnection, claims: dict[str, Any]) -> uuid.UUID | None:
    subject = str(claims["sub"])
    email = claims.get("email") if claims.get("email_verified") is True else None
    name = str(claims.get("name") or email or "New user")
    user_id = await connection.scalar(
        upsert(users)
        .values(
            subject=subject,
            email=email,
            display_name=name,
            initials=initials_of(name),
            avatar_colour=avatar_colour_of(subject),
        )
        .on_conflict_do_update(index_elements=[users.c.subject], set_={"email": email})
        .returning(users.c.id)
    )
    await record(
        connection,
        Actor(ActorKind.USER, subject),
        AuditAction.USER_SIGNED_IN,
        AuditTarget.PERSON,
        person=subject,
    )
    last_tenant = await connection.scalar(
        select(memberships.c.tenant_id)
        .join(users, users.c.id == memberships.c.user_id)
        .where(users.c.id == user_id, memberships.c.tenant_id == users.c.last_tenant_id)
    )
    if last_tenant is not None:
        return last_tenant
    tenant_ids = (
        await connection.scalars(
            select(memberships.c.tenant_id).where(memberships.c.user_id == user_id).limit(2)
        )
    ).all()
    return tenant_ids[0] if len(tenant_ids) == 1 else None


def set_cookie(response: Response, name: str, value: str, max_age: int, same_site: str) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path="/",
        secure=True,
        httponly=True,
        samesite=cast("Any", same_site),
    )


def clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/", secure=True, httponly=True)


def hop_to(path: str) -> HTMLResponse:
    target = html.escape(path, quote=True)
    return HTMLResponse(
        "<!doctype html><title>Signing in</title>"
        f'<meta http-equiv="refresh" content="0;url={target}">'
        f'<a href="{target}">Continue</a>',
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/login", include_in_schema=False)
async def start_login(
    request: Request, return_to: str = "/", reauth: bool = False
) -> RedirectResponse:
    state = auth_state(request)
    login_state = secrets.token_urlsafe(32)
    binding = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    nonce = secrets.token_urlsafe(24)
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        await connection.execute(delete(auth_logins).where(auth_logins.c.expires_at < func.now()))
        await connection.execute(
            insert(auth_logins).values(
                state_hash=digest(login_state),
                binding_hash=digest(binding),
                code_verifier=verifier,
                nonce=nonce,
                return_to=safe_return_path(return_to),
                expires_at=now() + LOGIN_LIFETIME,
            )
        )
    url = await state.identity.authorization_url(
        login_state, nonce, code_challenge(verifier), prompt="login" if reauth else None
    )
    response = RedirectResponse(url, status_code=302)
    set_cookie(response, LOGIN_COOKIE, binding, int(LOGIN_LIFETIME.total_seconds()), "lax")
    return response


@router.get("/callback", include_in_schema=False)
async def complete_login(
    request: Request, code: str | None = None, state: str | None = None
) -> HTMLResponse:
    binding = request.cookies.get(LOGIN_COOKIE)
    if not code or not state or not binding:
        raise LoginFailedError
    auth = auth_state(request)
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        login = (
            await connection.execute(
                delete(auth_logins)
                .where(
                    auth_logins.c.state_hash == digest(state),
                    auth_logins.c.expires_at > func.now(),
                )
                .returning(*auth_logins.c)
            )
        ).one_or_none()
    if login is None or not secrets.compare_digest(login.binding_hash, digest(binding)):
        raise LoginFailedError
    try:
        tokens = await auth.identity.exchange(code, login.code_verifier)
        claims = await auth.identity.verify_id_token(tokens.id_token, login.nonce)
    except IdentityError as error:
        raise LoginFailedError from error
    session_id = secrets.token_urlsafe(32)
    previous = request.cookies.get(SESSION_COOKIE)
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        if previous:
            await connection.execute(
                delete(sessions).where(
                    sessions.c.id_hash == digest(previous),
                    sessions.c.subject == str(claims["sub"]),
                )
            )
        active_tenant_id = await sign_in_user(connection, claims)
        limits = await session_limits(connection, active_tenant_id)
        await connection.execute(
            insert(sessions).values(
                id_hash=digest(session_id),
                subject=str(claims["sub"]),
                tokens=auth.cipher.seal(sealed_tokens(tokens, claims)),
                access_expires_at=now() + timedelta(seconds=tokens.expires_in),
                expires_at=now() + limits.lifetime,
                active_tenant_id=active_tenant_id,
                user_agent=request.headers.get("user-agent", "")[:USER_AGENT_LENGTH] or None,
            )
        )
    response = hop_to(login.return_to)
    set_cookie(response, SESSION_COOKIE, session_id, int(limits.lifetime.total_seconds()), "strict")
    clear_cookie(response, LOGIN_COOKIE)
    return response


@router.get("/logout", include_in_schema=False)
async def logout(request: Request) -> RedirectResponse:
    auth = auth_state(request)
    home = f"{auth.public_origin}/"
    session_id = request.cookies.get(SESSION_COOKIE)
    tokens: dict[str, Any] | None = None
    ended = None
    if session_id:
        async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
            ended = (
                await connection.execute(
                    delete(sessions)
                    .where(sessions.c.id_hash == digest(session_id))
                    .returning(sessions.c.tokens, sessions.c.subject)
                )
            ).one_or_none()
            if ended is not None:
                await record(
                    connection,
                    Actor(ActorKind.USER, ended.subject),
                    AuditAction.USER_SIGNED_OUT,
                    AuditTarget.PERSON,
                    person=ended.subject,
                )
        if ended is not None:
            try:
                tokens = auth.cipher.open(ended.tokens)
            except InvalidTag:
                tokens = None
    target = home
    if tokens is not None:
        try:
            await auth.identity.revoke(str(tokens["refresh_token"]))
            target = await auth.identity.end_session_url(str(tokens["id_token"]), home)
        except IdentityError:
            target = home
    response = RedirectResponse(target, status_code=302)
    clear_cookie(response, SESSION_COOKIE)
    return response


@router.get("/session", operation_id="getSession")
async def get_session(
    request: Request, principal: Annotated[Principal, Depends(authenticate)]
) -> Session:
    if isinstance(principal, ServicePrincipal):
        raise ForbiddenError
    auth = auth_state(request)
    session_id = request.cookies.get(SESSION_COOKIE, "")
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        sealed = await connection.scalar(
            select(sessions.c.tokens).where(sessions.c.id_hash == digest(session_id))
        )
    profile = auth.cipher.open(sealed) if sealed is not None else {}
    return Session(
        subject=principal.subject,
        name=profile.get("name"),
        email=profile.get("email"),
        operator=isinstance(principal, PlatformOperator),
    )
