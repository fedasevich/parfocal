import base64
import hashlib
import html
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, cast
from urllib.parse import urlencode

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, StringConstraints
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
from parfocal_api.problems import (
    ForbiddenError,
    ProblemError,
    TooManyRequestsError,
    UnauthenticatedError,
)
from parfocal_api.rate_limits import RateLimits, counted_wait, limits_for, seconds_to_wait
from parfocal_api.second_factor import (
    SecondFactorRequiredError,
    factors_of,
    has_second_factor,
    requires_two_factors,
)
from parfocal_api.sso import (
    connection_for_domain,
    linked_subject,
    provision_member,
    sso_connection_of,
)
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
from parfocal_api.token_keys import decoded_key, listed_keys
from parfocal_api.zitadel_login import ZitadelLogin
from parfocal_common.db import DatabaseScope, scoped_transaction

SESSION_COOKIE = "__Host-parfocal_session"
LOGIN_COOKIE = "__Host-parfocal_login"
LOGIN_LIFETIME = timedelta(minutes=10)
USER_AGENT_LENGTH = 200
LOGIN_HINT_LENGTH = 320
REFRESH_MARGIN = timedelta(seconds=30)
SEEN_INTERVAL = timedelta(minutes=1)
AUTH_SCOPE = DatabaseScope(auth=True)
API_TOKEN_PREFIX = "pf_"
SECOND_FACTOR_SETUP_PATH = "/ui/console/users/me"


class LoginFailedError(ProblemError):
    status = 400
    code = "login-failed"
    title = "Signing in did not work, try again"


class SessionKeyError(ValueError):
    def __init__(self) -> None:
        super().__init__("SESSION_KEY must be 32 bytes encoded as URL-safe base64")


def session_aead(key: str) -> AESGCM:
    try:
        raw = decoded_key(key)
    except ValueError as error:
        raise SessionKeyError from error
    if len(raw) != 32:
        raise SessionKeyError
    return AESGCM(raw)


class SessionCipher:
    def __init__(self, keys: str) -> None:
        listed = listed_keys(keys)
        if not listed:
            raise SessionKeyError
        self._aeads = [session_aead(key) for key in listed]

    def seal(self, value: dict[str, Any]) -> bytes:
        nonce = secrets.token_bytes(12)
        return nonce + self._aeads[0].encrypt(nonce, json.dumps(value).encode(), None)

    def open(self, sealed: bytes) -> dict[str, Any]:
        for aead in self._aeads:
            try:
                plain = aead.decrypt(sealed[:12], sealed[12:], None)
            except InvalidTag:
                continue
            opened: dict[str, Any] = json.loads(plain)
            return opened
        raise InvalidTag


@dataclass(frozen=True)
class AuthState:
    engine: AsyncEngine
    identity: OidcClient
    cipher: SessionCipher
    public_origin: str
    limits: RateLimits
    login: ZitadelLogin | None = None


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


def sealed_tokens(
    tokens: TokenSet, claims: dict[str, Any], earlier_factors: list[str] | None = None
) -> dict[str, Any]:
    return {
        "id_token": tokens.id_token,
        "refresh_token": tokens.refresh_token,
        "name": claims.get("name"),
        "email": claims.get("email"),
        "amr": factors_of(claims) or earlier_factors or [],
    }


async def load_session(
    connection: AsyncConnection, state: AuthState, session_id: str, *, for_update: bool = False
) -> dict[str, Any] | None:
    statement = select(sessions).where(
        sessions.c.id_hash == digest(session_id), sessions.c.expires_at > func.now()
    )
    row = (
        await connection.execute(statement.with_for_update() if for_update else statement)
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
            tokens=state.cipher.seal(sealed_tokens(renewed, claims, factors_of(tokens))),
            access_expires_at=now() + timedelta(seconds=renewed.expires_in),
        )
    )
    return True


def refresh_due(row: Any) -> bool:
    return bool(row.access_expires_at - REFRESH_MARGIN <= now())


async def refresh_once(state: AuthState, session_id: str) -> bool:
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        loaded = await load_session(connection, state, session_id, for_update=True)
        if loaded is None:
            return False
        if not refresh_due(loaded["row"]):
            return True
        return await refresh_session(connection, state, session_id, loaded["tokens"])


async def record_use(
    state: AuthState, session_id: str, seen_due: bool, counted: Principal | None
) -> int | None:
    if seen_due:
        async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
            await connection.execute(
                update(sessions)
                .where(
                    sessions.c.id_hash == digest(session_id),
                    sessions.c.last_seen_at + SEEN_INTERVAL <= func.now(),
                )
                .values(last_seen_at=func.now())
            )
    allowed = {} if counted is None else limits_for(counted, state.limits)
    if not allowed:
        return None
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        return await counted_wait(connection, allowed)


@dataclass(frozen=True)
class Resolved:
    subject: str
    user_id: uuid.UUID | None
    active_tenant_id: uuid.UUID | None
    operator: bool
    role: Role | None
    admin_rights: bool = False


async def resolve(
    connection: AsyncConnection, subject: str, active_tenant_id: uuid.UUID | None
) -> Resolved:
    user_id = await connection.scalar(select(users.c.id).where(users.c.subject == subject))
    operator = bool(
        await connection.scalar(select(exists().where(platform_operators.c.subject == subject)))
    )
    membership = None
    if user_id is not None and active_tenant_id is not None:
        membership = (
            await connection.execute(
                select(memberships.c.role, memberships.c.admin_rights).where(
                    memberships.c.user_id == user_id, memberships.c.tenant_id == active_tenant_id
                )
            )
        ).one_or_none()
    if membership is None:
        return Resolved(subject, user_id, active_tenant_id, operator, None)
    return Resolved(
        subject, user_id, active_tenant_id, operator, Role(membership.role), membership.admin_rights
    )


def principal_of(resolved: Resolved) -> Principal:
    if resolved.operator:
        return PlatformOperator(resolved.subject)
    if resolved.user_id is None:
        raise UnauthenticatedError
    if resolved.role is not None and resolved.active_tenant_id is not None:
        return MemberPrincipal(
            resolved.subject,
            resolved.active_tenant_id,
            resolved.user_id,
            resolved.role,
            resolved.admin_rights,
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
        principal = ServicePrincipal(row.account_id, row.tenant_id, frozenset(row.scopes))
        wait = await seconds_to_wait(connection, principal, state.limits)
    if wait is not None:
        raise TooManyRequestsError(wait)
    return principal


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
    needs_second_factor = False
    needs_refresh = False
    seen_due = False
    async with scoped_transaction(state.engine, AUTH_SCOPE) as connection:
        loaded = await load_session(connection, state, session_id)
        if loaded is not None:
            row = loaded["row"]
            limits = await session_limits(connection, row.active_tenant_id)
            if row.created_at + limits.lifetime <= now():
                await connection.execute(
                    delete(sessions).where(sessions.c.id_hash == digest(session_id))
                )
            elif row.active_at + limits.idle <= now():
                locked = True
            else:
                needs_refresh = refresh_due(row)
                seen_due = row.last_seen_at + SEEN_INTERVAL <= now()
                resolved = await resolve(connection, str(row.subject), row.active_tenant_id)
            if (
                resolved is not None
                and not resolved.operator
                and resolved.role is not None
                and resolved.active_tenant_id is not None
                and not has_second_factor(loaded["tokens"])
            ):
                needs_second_factor = await requires_two_factors(
                    connection, resolved.active_tenant_id
                )
    if locked:
        raise SessionLockedError
    if needs_refresh and not await refresh_once(state, session_id):
        resolved = None
    if resolved is None:
        raise UnauthenticatedError
    counted = None if needs_second_factor else principal_of(resolved)
    wait = await record_use(state, session_id, seen_due and not needs_refresh, counted)
    if needs_second_factor:
        raise SecondFactorRequiredError
    if wait is not None:
        raise TooManyRequestsError(wait)
    return principal_of(resolved)


def initials_of(name: str) -> str:
    letters = [word[0] for word in name.split() if word[:1].isalpha()]
    picked = letters[0] + letters[-1] if len(letters) > 1 else "".join(letters[:1])
    initials = "".join(letter for letter in picked.upper() if "A" <= letter <= "Z")
    return initials or "U"


def avatar_colour_of(subject: str) -> int:
    return hashlib.sha256(subject.encode()).digest()[0] % AVATAR_COLOURS


SEEDED_SUBJECT_PREFIX = "seed:"
SEEDED_OWNER_NAME = "Workspace owner"


def stored_name_after_sign_in(stored: str | None, profile_name: object) -> str | None:
    if stored != SEEDED_OWNER_NAME or not isinstance(profile_name, str):
        return None
    chosen = profile_name.strip()
    return chosen or None


NO_SSO_CONNECTION_PATH = "/sign-in"


async def adopt_seeded_user(connection: AsyncConnection, subject: str, email: str) -> None:
    known = await connection.scalar(select(users.c.id).where(users.c.subject == subject))
    if known is None:
        await connection.execute(
            update(users)
            .where(users.c.subject == f"{SEEDED_SUBJECT_PREFIX}{email.lower()}")
            .values(subject=subject)
        )


@dataclass(frozen=True)
class SignedIn:
    subject: str
    tenant_id: uuid.UUID | None


async def sign_in_user(connection: AsyncConnection, claims: dict[str, Any]) -> SignedIn:
    token_subject = str(claims["sub"])
    email = claims.get("email") if claims.get("email_verified") is True else None
    sso = await sso_connection_of(connection, claims)
    if sso is not None and email is not None and not sso.vouches_for(str(email)):
        email = None
    name = str(claims.get("name") or email or "New user")
    if email is not None:
        await adopt_seeded_user(connection, token_subject, str(email))
    subject = await linked_subject(
        connection, token_subject, sso, None if email is None else str(email)
    )
    stored_name = await connection.scalar(
        select(users.c.display_name).where(users.c.subject == subject)
    )
    adopted_name = stored_name_after_sign_in(stored_name, claims.get("name"))
    refreshed: dict[str, Any] = {"email": email}
    if adopted_name is not None:
        refreshed |= {"display_name": adopted_name, "initials": initials_of(adopted_name)}
    user_id = await connection.scalar(
        upsert(users)
        .values(
            subject=subject,
            email=email,
            display_name=name,
            initials=initials_of(name),
            avatar_colour=avatar_colour_of(subject),
        )
        .on_conflict_do_update(index_elements=[users.c.subject], set_=refreshed)
        .returning(users.c.id)
    )
    await record(
        connection,
        Actor(ActorKind.USER, subject),
        AuditAction.USER_SIGNED_IN,
        AuditTarget.PERSON,
        person=subject,
    )
    if sso is not None:
        assert isinstance(user_id, uuid.UUID)
        provisioned = await provision_member(connection, sso, user_id, subject, claims)
        if provisioned is not None:
            return SignedIn(subject, provisioned)
    last_tenant = await connection.scalar(
        select(memberships.c.tenant_id)
        .join(users, users.c.id == memberships.c.user_id)
        .where(users.c.id == user_id, memberships.c.tenant_id == users.c.last_tenant_id)
    )
    if last_tenant is not None:
        return SignedIn(subject, last_tenant)
    tenant_ids = (
        await connection.scalars(
            select(memberships.c.tenant_id).where(memberships.c.user_id == user_id).limit(2)
        )
    ).all()
    return SignedIn(subject, tenant_ids[0] if len(tenant_ids) == 1 else None)


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


async def open_session(
    request: Request,
    auth: AuthState,
    response: Response,
    tokens: TokenSet,
    claims: dict[str, Any],
) -> None:
    session_id = secrets.token_urlsafe(32)
    previous = request.cookies.get(SESSION_COOKIE)
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        signed_in = await sign_in_user(connection, claims)
        if previous:
            await connection.execute(
                delete(sessions).where(
                    sessions.c.id_hash == digest(previous),
                    sessions.c.subject == signed_in.subject,
                )
            )
        active_tenant_id = signed_in.tenant_id
        limits = await session_limits(connection, active_tenant_id)
        await connection.execute(
            insert(sessions).values(
                id_hash=digest(session_id),
                subject=signed_in.subject,
                tokens=auth.cipher.seal(sealed_tokens(tokens, claims)),
                access_expires_at=now() + timedelta(seconds=tokens.expires_in),
                expires_at=now() + limits.lifetime,
                active_tenant_id=active_tenant_id,
                user_agent=request.headers.get("user-agent", "")[:USER_AGENT_LENGTH] or None,
            )
        )
    set_cookie(response, SESSION_COOKIE, session_id, int(limits.lifetime.total_seconds()), "strict")


router = APIRouter(prefix="/api/auth", tags=["auth"])


async def redirect_to_identity(
    request: Request,
    return_to: str,
    prompt: str | None = None,
    extra_scopes: tuple[str, ...] = (),
    login_hint: str | None = None,
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
        login_state,
        nonce,
        code_challenge(verifier),
        prompt=prompt,
        extra_scopes=extra_scopes,
        login_hint=login_hint,
    )
    response = RedirectResponse(url, status_code=302)
    set_cookie(response, LOGIN_COOKIE, binding, int(LOGIN_LIFETIME.total_seconds()), "lax")
    return response


@router.get("/login", include_in_schema=False)
async def start_login(
    request: Request, return_to: str = "/", reauth: bool = False
) -> RedirectResponse:
    return await redirect_to_identity(request, return_to, prompt="login" if reauth else None)


class NamedLogin(BaseModel):
    return_to: Annotated[str, StringConstraints(max_length=2048)] = "/"
    reauth: bool = False
    login_hint: Annotated[str, StringConstraints(max_length=LOGIN_HINT_LENGTH)] = ""


class LoginLocation(BaseModel):
    location: str


@router.post("/login", include_in_schema=False)
async def start_named_login(attempt: NamedLogin, request: Request) -> JSONResponse:
    started = await redirect_to_identity(
        request,
        attempt.return_to,
        prompt="login" if attempt.reauth else None,
        login_hint=attempt.login_hint.strip() or None,
    )
    response = JSONResponse(
        LoginLocation(location=started.headers["location"]).model_dump(),
        headers={"Cache-Control": "no-store"},
    )
    response.headers.append("set-cookie", started.headers["set-cookie"])
    return response


@router.get("/second-factor", include_in_schema=False)
async def set_up_second_factor(request: Request) -> RedirectResponse:
    return RedirectResponse(
        f"{auth_state(request).identity.issuer}{SECOND_FACTOR_SETUP_PATH}", status_code=302
    )


@router.get("/sso", include_in_schema=False)
async def start_sso_login(request: Request, domain: str, return_to: str = "/") -> RedirectResponse:
    async with scoped_transaction(auth_state(request).engine, AUTH_SCOPE) as connection:
        sso = await connection_for_domain(connection, domain)
    if sso is None:
        query = urlencode({"sso": "none", "return_to": return_to})
        return RedirectResponse(f"{NO_SSO_CONNECTION_PATH}?{query}", status_code=302)
    return await redirect_to_identity(request, return_to, extra_scopes=sso.scopes())


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
    response = hop_to(login.return_to)
    await open_session(request, auth, response, tokens, claims)
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
