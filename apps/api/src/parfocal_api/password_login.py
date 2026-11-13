import base64
import re
import secrets
from typing import Annotated, Literal

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from parfocal_api.auth import (
    AUTH_SCOPE,
    AuthState,
    LoginFailedError,
    auth_state,
    clear_cookie,
    code_challenge,
    digest,
    open_session,
    safe_return_path,
    set_cookie,
)
from parfocal_api.oidc import IdentityError
from parfocal_api.problems import (
    FieldError,
    NotFoundError,
    ProblemError,
    TooManyRequestsError,
    problem_response,
)
from parfocal_api.rate_limits import counted_wait
from parfocal_api.zitadel_login import (
    AccountExistsError,
    CheckedSession,
    LoginClientError,
    PasswordRejectedError,
    WrongCodeError,
    WrongPasswordError,
    ZitadelLogin,
)
from parfocal_common.db import scoped_transaction

SIGN_UP_COOKIE = "__Host-parfocal_signup"
SIGN_UP_MINUTES = 30
RESEND_SECONDS = 60
MIN_PASSWORD_LENGTH = 12
ATTEMPTS_PER_MINUTE = 10
SETUP_AFTER_SIGN_UP = "/setup?step=role"
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

Text = Annotated[str, StringConstraints(max_length=320)]


class AccountTakenError(ProblemError):
    status = 409
    code = "account-exists"
    title = "This email already has an account. Sign in instead"


class InvalidCodeError(ProblemError):
    status = 401
    code = "invalid-code"
    title = "That code is wrong or has expired"


class SignUpExpiredError(ProblemError):
    status = 400
    code = "sign-up-expired"
    title = "This sign-up has expired. Start again"


class InvalidCredentialsError(ProblemError):
    status = 401
    code = "invalid-credentials"
    title = "The email or password is wrong"


class EmailUnverifiedError(ProblemError):
    status = 403
    code = "email-unverified"
    title = "Confirm your email first. Sign up again with this email for a new code"


class IdentityUnavailableError(ProblemError):
    status = 502
    code = "identity-unavailable"
    title = "Signing in is not working right now, try again soon"


class PasswordSignInAvailability(BaseModel):
    available: bool


class NewAccount(BaseModel):
    name: Text
    email: Text
    password: Text
    role: Literal["run", "review"]
    accepted_terms: bool


class EmailConfirmation(BaseModel):
    email: Text
    code: Annotated[str, StringConstraints(max_length=32)]


class EmailCodeResend(BaseModel):
    email: Text


class PasswordSignIn(BaseModel):
    email: Text
    password: Text
    keep_signed_in: bool = False
    return_to: Text | None = None


class AccountCodeSent(BaseModel):
    email: str
    expires_minutes: int
    resend_seconds: int


class SignInLanding(BaseModel):
    return_to: str


def login_of(auth: AuthState) -> ZitadelLogin:
    if auth.login is None:
        raise NotFoundError
    return auth.login


def account_issues(account: NewAccount) -> list[FieldError]:
    issues: list[FieldError] = []
    if not account.name.strip():
        issues.append(
            FieldError(location=["body", "name"], message="Enter your name", code="required")
        )
    if not EMAIL_PATTERN.match(account.email.strip()):
        issues.append(
            FieldError(
                location=["body", "email"],
                message="Enter an email like name@institution.org",
                code="invalid-email",
            )
        )
    if len(account.password) < MIN_PASSWORD_LENGTH:
        issues.append(
            FieldError(
                location=["body", "password"],
                message=f"Use at least {MIN_PASSWORD_LENGTH} characters",
                code="too-short",
            )
        )
    if not account.accepted_terms:
        issues.append(
            FieldError(
                location=["body", "accepted_terms"],
                message="Agree to the terms to create an account",
                code="terms-required",
            )
        )
    return issues


def rejected_password() -> JSONResponse:
    return problem_response(
        422,
        "invalid-account",
        "Check the highlighted details",
        errors=[
            FieldError(
                location=["body", "password"],
                message="Use upper and lower case letters, a number and a symbol",
                code="weak-password",
            )
        ],
    )


async def throttle(auth: AuthState, purpose: str, email: str) -> None:
    key = f"{purpose}:{digest(email.strip().lower()).hex()}"
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        wait = await counted_wait(connection, {key: ATTEMPTS_PER_MINUTE})
    if wait is not None:
        raise TooManyRequestsError(wait)


def code_sent(email: str) -> AccountCodeSent:
    return AccountCodeSent(
        email=email, expires_minutes=SIGN_UP_MINUTES, resend_seconds=RESEND_SECONDS
    )


def remember_sign_up(
    auth: AuthState, response: Response, user_id: str, email: str, session: CheckedSession
) -> None:
    sealed = auth.cipher.seal(
        {
            "user_id": user_id,
            "email": email.lower(),
            "session_id": session.session_id,
            "session_token": session.session_token,
        }
    )
    value = base64.urlsafe_b64encode(sealed).decode()
    set_cookie(response, SIGN_UP_COOKIE, value, SIGN_UP_MINUTES * 60, "strict")


def pending_sign_up(request: Request, auth: AuthState, email: str) -> dict[str, str]:
    value = request.cookies.get(SIGN_UP_COOKIE)
    if not value:
        raise SignUpExpiredError
    try:
        pending = auth.cipher.open(base64.urlsafe_b64decode(value))
    except (InvalidTag, ValueError) as error:
        raise SignUpExpiredError from error
    if pending.get("email") != email.strip().lower():
        raise SignUpExpiredError
    return {name: str(item) for name, item in pending.items()}


async def finish_login(
    request: Request,
    auth: AuthState,
    login: ZitadelLogin,
    session: CheckedSession,
    response: Response,
) -> None:
    expected_state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    nonce = secrets.token_urlsafe(24)
    try:
        url = await auth.identity.authorization_url(expected_state, nonce, code_challenge(verifier))
        auth_request = await login.start_auth_request(url)
        callback = await login.finalize(auth_request, session)
        if not secrets.compare_digest(callback["state"], expected_state):
            raise LoginFailedError
        tokens = await auth.identity.exchange(callback["code"], verifier)
        claims = await auth.identity.verify_id_token(tokens.id_token, nonce)
    except (IdentityError, LoginClientError) as error:
        raise LoginFailedError from error
    await open_session(request, auth, response, tokens, claims)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/password-sign-in", operation_id="getPasswordSignIn")
async def get_password_sign_in(request: Request) -> PasswordSignInAvailability:
    return PasswordSignInAvailability(available=auth_state(request).login is not None)


@router.post("/sign-up", operation_id="createAccount", response_model=AccountCodeSent)
async def create_account(
    account: NewAccount, request: Request, response: Response
) -> AccountCodeSent | JSONResponse:
    auth = auth_state(request)
    login = login_of(auth)
    issues = account_issues(account)
    if issues:
        return problem_response(
            422, "invalid-account", "Check the highlighted details", errors=issues
        )
    email = account.email.strip()
    await throttle(auth, "sign-up", email)
    try:
        found = await login.find_user(email)
        if found is not None:
            if found.verified:
                raise AccountTakenError
            try:
                session = await login.check_password(found.user_id, account.password)
            except WrongPasswordError as error:
                raise AccountTakenError from error
            await login.resend_code(found.user_id)
            user_id = found.user_id
        else:
            user_id = await login.create_user(account.name, email, account.password)
            session = await login.check_password(user_id, account.password)
    except AccountExistsError as error:
        raise AccountTakenError from error
    except PasswordRejectedError:
        return rejected_password()
    except (LoginClientError, WrongPasswordError) as error:
        raise IdentityUnavailableError from error
    remember_sign_up(auth, response, user_id, email, session)
    return code_sent(email)


@router.post("/sign-up/confirm", operation_id="confirmEmail")
async def confirm_email(
    confirmation: EmailConfirmation, request: Request, response: Response
) -> SignInLanding:
    auth = auth_state(request)
    login = login_of(auth)
    pending = pending_sign_up(request, auth, confirmation.email)
    await throttle(auth, "confirm", confirmation.email)
    try:
        await login.verify_email(pending["user_id"], confirmation.code.strip())
    except WrongCodeError as error:
        raise InvalidCodeError from error
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    session = CheckedSession(pending["session_id"], pending["session_token"])
    await finish_login(request, auth, login, session, response)
    clear_cookie(response, SIGN_UP_COOKIE)
    return SignInLanding(return_to=SETUP_AFTER_SIGN_UP)


@router.post("/sign-up/resend", operation_id="resendEmailCode")
async def resend_email_code(resend: EmailCodeResend, request: Request) -> AccountCodeSent:
    auth = auth_state(request)
    login = login_of(auth)
    pending = pending_sign_up(request, auth, resend.email)
    await throttle(auth, "resend", resend.email)
    try:
        await login.resend_code(pending["user_id"])
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    return code_sent(resend.email.strip())


@router.post("/sign-in", operation_id="signInWithPassword")
async def sign_in_with_password(
    attempt: PasswordSignIn, request: Request, response: Response
) -> SignInLanding:
    auth = auth_state(request)
    login = login_of(auth)
    email = attempt.email.strip()
    await throttle(auth, "sign-in", email)
    try:
        found = await login.find_user(email)
        if found is None:
            raise InvalidCredentialsError
        session = await login.check_password(found.user_id, attempt.password)
    except WrongPasswordError as error:
        raise InvalidCredentialsError from error
    except LoginClientError as error:
        raise IdentityUnavailableError from error
    if not found.verified:
        raise EmailUnverifiedError
    await finish_login(request, auth, login, session, response)
    return SignInLanding(return_to=safe_return_path(attempt.return_to or "/"))
