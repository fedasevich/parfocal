import base64
from typing import Annotated, Any

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, StringConstraints

from parfocal_api.auth import AuthState, auth_state, clear_cookie, safe_return_path, set_cookie
from parfocal_api.context import CurrentPrincipal
from parfocal_api.password_login import (
    EmailUnverifiedError,
    IdentityUnavailableError,
    SignInLanding,
    Text,
    finish_login,
    login_of,
    throttle,
)
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.users import signed_in
from parfocal_api.zitadel_login import (
    CheckedSession,
    LoginClientError,
    PasskeyRejectedError,
    ZitadelLogin,
)

PASSKEY_COOKIE = "__Host-parfocal_passkey"
PASSKEY_MINUTES = 5
DEFAULT_PASSKEY_NAME = "Passkey"

Name = Annotated[str, StringConstraints(max_length=64)]
Identifier = Annotated[str, StringConstraints(max_length=64)]


class NoPasskeyError(ProblemError):
    status = 404
    code = "no-passkey"
    title = "No passkey is saved for this email. Sign in with your password, then save one"


class PasskeyRefusedError(ProblemError):
    status = 401
    code = "passkey-refused"
    title = "That passkey did not work. Try again or sign in with your password"


class PasskeyExpiredError(ProblemError):
    status = 400
    code = "passkey-expired"
    title = "The passkey request has expired. Try again"


class SavedPasskeySummary(BaseModel):
    id: str
    name: str


class PasskeyCreation(BaseModel):
    passkey: str
    options: dict[str, Any]


class NewPasskey(BaseModel):
    passkey: Identifier
    name: Name = DEFAULT_PASSKEY_NAME
    credential: dict[str, Any]


class PasskeySignInStart(BaseModel):
    email: Text


class PasskeyRequest(BaseModel):
    options: dict[str, Any]


class PasskeySignInFinish(BaseModel):
    credential: dict[str, Any]
    return_to: Text | None = None


def remember_challenge(
    auth: AuthState, response: Response, user_id: str, verified: bool, session: CheckedSession
) -> None:
    sealed = auth.cipher.seal(
        {
            "user_id": user_id,
            "verified": verified,
            "session_id": session.session_id,
            "session_token": session.session_token,
        }
    )
    value = base64.urlsafe_b64encode(sealed).decode()
    set_cookie(response, PASSKEY_COOKIE, value, PASSKEY_MINUTES * 60, "strict")


def pending_challenge(request: Request, auth: AuthState) -> dict[str, Any]:
    value = request.cookies.get(PASSKEY_COOKIE)
    if not value:
        raise PasskeyExpiredError
    try:
        return auth.cipher.open(base64.urlsafe_b64decode(value))
    except (InvalidTag, ValueError) as error:
        raise PasskeyExpiredError from error


def subject_login(request: Request, principal: CurrentPrincipal) -> tuple[ZitadelLogin, str]:
    person = signed_in(principal)
    return login_of(auth_state(request)), person.subject


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/passkeys", operation_id="listPasskeys")
async def list_passkeys(request: Request, principal: CurrentPrincipal) -> list[SavedPasskeySummary]:
    login, subject = subject_login(request, principal)
    try:
        saved = await login.passkeys(subject)
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    return [SavedPasskeySummary(id=item.passkey_id, name=item.name) for item in saved]


@router.post("/passkeys/registration", operation_id="startPasskeyRegistration")
async def start_passkey_registration(
    request: Request, principal: CurrentPrincipal
) -> PasskeyCreation:
    login, subject = subject_login(request, principal)
    try:
        registration = await login.start_passkey_registration(subject)
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    return PasskeyCreation(passkey=registration.passkey_id, options=registration.options)


@router.post("/passkeys", operation_id="savePasskey")
async def save_passkey(
    passkey: NewPasskey, request: Request, principal: CurrentPrincipal
) -> SavedPasskeySummary:
    login, subject = subject_login(request, principal)
    name = passkey.name.strip() or DEFAULT_PASSKEY_NAME
    try:
        await login.finish_passkey_registration(subject, passkey.passkey, passkey.credential, name)
    except PasskeyRejectedError as error:
        raise PasskeyRefusedError from error
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    return SavedPasskeySummary(id=passkey.passkey, name=name)


@router.delete("/passkeys/{passkey_id}", operation_id="removePasskey", status_code=204)
async def remove_passkey(passkey_id: str, request: Request, principal: CurrentPrincipal) -> None:
    login, subject = subject_login(request, principal)
    try:
        saved = await login.passkeys(subject)
        if passkey_id not in {item.passkey_id for item in saved}:
            raise NotFoundError
        await login.remove_passkey(subject, passkey_id)
    except PasskeyRejectedError as error:
        raise NotFoundError from error
    except LoginClientError as error:
        raise IdentityUnavailableError from error


@router.post("/passkey-sign-in", operation_id="startPasskeySignIn")
async def start_passkey_sign_in(
    attempt: PasskeySignInStart, request: Request, response: Response
) -> PasskeyRequest:
    auth = auth_state(request)
    login = login_of(auth)
    email = attempt.email.strip()
    await throttle(auth, "passkey", email)
    try:
        found = await login.find_user(email)
        if found is None or not await login.passkeys(found.user_id):
            raise NoPasskeyError
        challenge = await login.passkey_challenge(found.user_id)
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    remember_challenge(auth, response, found.user_id, found.verified, challenge.session)
    return PasskeyRequest(options=challenge.options)


@router.post("/passkey-sign-in/finish", operation_id="finishPasskeySignIn")
async def finish_passkey_sign_in(
    attempt: PasskeySignInFinish, request: Request, response: Response
) -> SignInLanding:
    auth = auth_state(request)
    login = login_of(auth)
    pending = pending_challenge(request, auth)
    try:
        session = await login.check_passkey(str(pending["session_id"]), attempt.credential)
    except PasskeyRejectedError as error:
        raise PasskeyRefusedError from error
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    if not pending.get("verified"):
        raise EmailUnverifiedError
    await finish_login(request, auth, login, session, response)
    clear_cookie(response, PASSKEY_COOKIE)
    return SignInLanding(return_to=safe_return_path(attempt.return_to or "/"))
