from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx2

from parfocal_api.settings import ApiSettings

LOGIN_CLIENT_HEADER = "x-zitadel-login-client"
SESSION_LIFETIME = "1800s"


class LoginClientError(Exception):
    pass


class AccountExistsError(LoginClientError):
    pass


class PasswordRejectedError(LoginClientError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class WrongCodeError(LoginClientError):
    pass


class WrongPasswordError(LoginClientError):
    pass


@dataclass(frozen=True)
class FoundUser:
    user_id: str
    verified: bool


@dataclass(frozen=True)
class CheckedSession:
    session_id: str
    session_token: str


def split_name(name: str) -> tuple[str, str]:
    given, _, family = name.strip().rpartition(" ")
    if not given:
        return family, family
    return given.strip(), family


def zitadel_message(response: httpx2.Response) -> str:
    try:
        body: dict[str, Any] = response.json()
    except ValueError:
        return ""
    return str(body.get("message", ""))


@dataclass(frozen=True)
class ZitadelLogin:
    base_url: str
    login_client_id: str
    token: str
    organization_id: str | None
    http: httpx2.AsyncClient

    def headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.token}", "accept": "application/json"}

    async def call(self, method: str, path: str, body: dict[str, Any]) -> httpx2.Response:
        try:
            return await self.http.request(
                method, f"{self.base_url}{path}", json=body, headers=self.headers()
            )
        except httpx2.HTTPError as error:
            raise LoginClientError from error

    async def ok(self, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self.call(method, path, body)
        if response.status_code >= 300:
            raise LoginClientError(f"{path} answered {response.status_code}")
        payload: dict[str, Any] = response.json()
        return payload

    async def find_user(self, email: str) -> FoundUser | None:
        payload = await self.ok(
            "POST",
            "/v2/users",
            {
                "query": {"limit": 2},
                "queries": [
                    {
                        "emailQuery": {
                            "emailAddress": email,
                            "method": "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
                        }
                    }
                ],
            },
        )
        found = [user for user in payload.get("result", []) if "human" in user]
        if len(found) != 1:
            return None
        email_state = found[0]["human"].get("email", {})
        return FoundUser(str(found[0]["userId"]), bool(email_state.get("isVerified", False)))

    async def create_user(self, name: str, email: str, password: str) -> str:
        given, family = split_name(name)
        body: dict[str, Any] = {
            "profile": {"givenName": given, "familyName": family, "displayName": name.strip()},
            "email": {"email": email, "sendCode": {}},
            "password": {"password": password, "changeRequired": False},
        }
        if self.organization_id:
            body["organization"] = {"orgId": self.organization_id}
        response = await self.call("POST", "/v2/users/human", body)
        if response.status_code == 409:
            raise AccountExistsError
        if response.status_code == 400:
            raise PasswordRejectedError(zitadel_message(response))
        if response.status_code >= 300:
            raise LoginClientError(f"creating a user answered {response.status_code}")
        return str(response.json()["userId"])

    async def resend_code(self, user_id: str) -> None:
        await self.ok("POST", f"/v2/users/{user_id}/email/resend", {"sendCode": {}})

    async def verify_email(self, user_id: str, code: str) -> None:
        response = await self.call(
            "POST", f"/v2/users/{user_id}/email/verify", {"verificationCode": code}
        )
        if 400 <= response.status_code < 500:
            raise WrongCodeError
        if response.status_code >= 300:
            raise LoginClientError(f"verifying an email answered {response.status_code}")

    async def check_password(self, user_id: str, password: str) -> CheckedSession:
        response = await self.call(
            "POST",
            "/v2/sessions",
            {
                "checks": {"user": {"userId": user_id}, "password": {"password": password}},
                "lifetime": SESSION_LIFETIME,
            },
        )
        if 400 <= response.status_code < 500:
            raise WrongPasswordError
        if response.status_code >= 300:
            raise LoginClientError(f"creating a session answered {response.status_code}")
        payload = response.json()
        return CheckedSession(str(payload["sessionId"]), str(payload["sessionToken"]))

    async def start_auth_request(self, authorization_url: str) -> str:
        try:
            response = await self.http.get(
                authorization_url,
                headers={LOGIN_CLIENT_HEADER: self.login_client_id},
                follow_redirects=False,
            )
        except httpx2.HTTPError as error:
            raise LoginClientError from error
        location = response.headers.get("location", "")
        found = parse_qs(urlparse(location).query).get("authRequest")
        if response.status_code not in (302, 303) or not found:
            raise LoginClientError(f"the authorize call answered {response.status_code}")
        return found[0]

    async def finalize(self, auth_request_id: str, session: CheckedSession) -> dict[str, str]:
        payload = await self.ok(
            "POST",
            f"/v2/oidc/auth_requests/{auth_request_id}",
            {
                "session": {
                    "sessionId": session.session_id,
                    "sessionToken": session.session_token,
                }
            },
        )
        query = parse_qs(urlparse(str(payload.get("callbackUrl", ""))).query)
        if "code" not in query or "state" not in query:
            raise LoginClientError("the callback carried no code")
        return {"code": query["code"][0], "state": query["state"][0]}


def login_client(settings: ApiSettings, http: httpx2.AsyncClient) -> ZitadelLogin | None:
    if not settings.zitadel_login_client_id or settings.zitadel_login_token is None:
        return None
    return ZitadelLogin(
        base_url=str(settings.zitadel_issuer).rstrip("/"),
        login_client_id=settings.zitadel_login_client_id,
        token=settings.zitadel_login_token.get_secret_value(),
        organization_id=settings.zitadel_organization_id,
        http=http,
    )
