import json
import secrets
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx2
import pytest
from db_support import api_settings
from fastapi.testclient import TestClient
from idp_support import CLIENT_ID, CLIENT_SECRET, ISSUER, ORIGIN, FakeIdp, Grant
from pydantic import SecretStr

from parfocal_api.app import create_app
from parfocal_api.auth import SESSION_COOKIE
from parfocal_api.oidc import OidcClient
from parfocal_api.password_login import SIGN_UP_COOKIE

pytestmark = pytest.mark.db

LOGIN_CLIENT = "login-client-user"
LOGIN_TOKEN = "login-client-token"
PASSWORD = "Correct-Horse-9-battery"
CODE = "482913"


@dataclass
class ZitadelUser:
    email: str
    password: str
    verified: bool = False


@dataclass
class FakeZitadel:
    idp: FakeIdp = field(default_factory=FakeIdp)
    users: dict[str, ZitadelUser] = field(default_factory=dict[str, ZitadelUser])
    sessions: dict[str, tuple[str, str]] = field(default_factory=dict[str, tuple[str, str]])
    auth_requests: dict[str, str] = field(default_factory=dict[str, str])
    codes_sent: list[str] = field(default_factory=list[str])

    def add_user(self, email: str, password: str, *, verified: bool) -> str:
        user_id = f"user-{secrets.token_hex(4)}"
        self.users[user_id] = ZitadelUser(email, password, verified)
        return user_id

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path == "/authorize" and request.method == "GET":
            return self.authorize(request)
        if not path.startswith("/v2/"):
            return self.idp.handle(request)
        if request.headers.get("authorization") != f"Bearer {LOGIN_TOKEN}":
            return httpx2.Response(401, json={"code": 16, "message": "unauthenticated"})
        body: dict[str, Any] = json.loads(request.content or b"{}")
        parts = path.strip("/").split("/")
        match parts:
            case ["v2", "users"]:
                return self.search(body)
            case ["v2", "users", "human"]:
                return self.create(body)
            case ["v2", "users", user_id, "email", "resend"]:
                self.codes_sent.append(user_id)
                return httpx2.Response(200, json={})
            case ["v2", "users", user_id, "email", "verify"]:
                if body.get("verificationCode") != CODE:
                    return httpx2.Response(400, json={"code": 3, "message": "code invalid"})
                self.users[user_id].verified = True
                return httpx2.Response(200, json={})
            case ["v2", "sessions"]:
                return self.check(body)
            case ["v2", "oidc", "auth_requests", request_id]:
                return self.finalize(request_id, body)
            case _:
                return httpx2.Response(404, json={})

    def authorize(self, request: httpx2.Request) -> httpx2.Response:
        if request.headers.get("x-zitadel-login-client") != LOGIN_CLIENT:
            return httpx2.Response(200, text="hosted login page")
        request_id = f"V2_{secrets.token_hex(4)}"
        self.auth_requests[request_id] = str(request.url)
        return httpx2.Response(
            302, headers={"location": f"{ISSUER}/ui/v2/login/login?authRequest={request_id}"}
        )

    def search(self, body: dict[str, Any]) -> httpx2.Response:
        wanted = body["queries"][0]["emailQuery"]["emailAddress"].lower()
        result = [
            {
                "userId": user_id,
                "human": {"email": {"email": user.email, "isVerified": user.verified}},
            }
            for user_id, user in self.users.items()
            if user.email.lower() == wanted
        ]
        return httpx2.Response(200, json={"result": result})

    def create(self, body: dict[str, Any]) -> httpx2.Response:
        email = body["email"]["email"]
        if any(user.email.lower() == email.lower() for user in self.users.values()):
            return httpx2.Response(409, json={"code": 6, "message": "User already exists"})
        password = body["password"]["password"]
        if password.isalnum():
            return httpx2.Response(400, json={"code": 3, "message": "Password must contain symbol"})
        user_id = self.add_user(email, password, verified=False)
        self.codes_sent.append(user_id)
        return httpx2.Response(201, json={"userId": user_id})

    def check(self, body: dict[str, Any]) -> httpx2.Response:
        user_id = body["checks"]["user"]["userId"]
        user = self.users.get(user_id)
        if user is None or body["checks"]["password"]["password"] != user.password:
            return httpx2.Response(400, json={"code": 3, "message": "Password invalid"})
        session_id = secrets.token_hex(6)
        token = secrets.token_urlsafe(12)
        self.sessions[session_id] = (token, user_id)
        return httpx2.Response(201, json={"sessionId": session_id, "sessionToken": token})

    def finalize(self, request_id: str, body: dict[str, Any]) -> httpx2.Response:
        url = self.auth_requests.pop(request_id, None)
        session = self.sessions.get(body["session"]["sessionId"])
        if url is None or session is None or session[0] != body["session"]["sessionToken"]:
            return httpx2.Response(400, json={"code": 3, "message": "not finalizable"})
        query = {name: values[0] for name, values in parse_qs(urlparse(url).query).items()}
        code = secrets.token_urlsafe(16)
        self.idp.codes[code] = Grant(query["nonce"], query["code_challenge"], session[1])
        callback = f"{query['redirect_uri']}?{urlencode({'code': code, 'state': query['state']})}"
        return httpx2.Response(200, json={"callbackUrl": callback})


@dataclass
class Visitor:
    client: TestClient
    zitadel: FakeZitadel

    def sign_up(self, email: str = "new.person@example.test", **changes: object) -> httpx2.Response:
        body = {
            "name": "New Person",
            "email": email,
            "password": PASSWORD,
            "role": "run",
            "accepted_terms": True,
        } | changes
        return self.client.post("/api/auth/sign-up", json=body)

    def confirm(self, email: str = "new.person@example.test", code: str = CODE) -> httpx2.Response:
        return self.client.post("/api/auth/sign-up/confirm", json={"email": email, "code": code})

    def sign_in(self, email: str, password: str = PASSWORD) -> httpx2.Response:
        return self.client.post(
            "/api/auth/sign-in",
            json={
                "email": email,
                "password": password,
                "keep_signed_in": False,
                "return_to": "/cases",
            },
        )


def fake_identity(zitadel: FakeZitadel) -> OidcClient:
    return OidcClient(
        issuer=ISSUER,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=f"{ORIGIN}/api/auth/callback",
        http=httpx2.AsyncClient(transport=httpx2.MockTransport(zitadel.handle)),
    )


def visiting(database: str, **changes: object) -> Iterator[Visitor]:
    zitadel = FakeZitadel()
    settings = api_settings(database).model_copy(update=changes)
    app = create_app(settings, identity=fake_identity(zitadel))
    with TestClient(
        app, base_url="https://testserver", follow_redirects=False, headers={"origin": ORIGIN}
    ) as client:
        yield Visitor(client, zitadel)


@pytest.fixture
def visitor(database: str) -> Iterator[Visitor]:
    yield from visiting(
        database,
        zitadel_login_client_id=LOGIN_CLIENT,
        zitadel_login_token=SecretStr(LOGIN_TOKEN),
    )


@pytest.fixture
def hosted_only(database: str) -> Iterator[Visitor]:
    yield from visiting(database)


def signed_in_subject(visitor: Visitor) -> str:
    session = visitor.client.get("/api/auth/session")
    assert session.status_code == 200, session.text
    return str(session.json()["subject"])


def test_password_sign_in_is_off_without_a_login_client(hosted_only: Visitor) -> None:
    assert hosted_only.client.get("/api/auth/password-sign-in").json() == {"available": False}
    assert hosted_only.sign_up().status_code == 404
    assert hosted_only.sign_in("someone@example.test").status_code == 404


def test_sign_up_sends_a_code_and_confirming_it_signs_in(visitor: Visitor) -> None:
    assert visitor.client.get("/api/auth/password-sign-in").json() == {"available": True}
    sent = visitor.sign_up()
    assert sent.status_code == 200, sent.text
    assert sent.json() == {
        "email": "new.person@example.test",
        "expires_minutes": 30,
        "resend_seconds": 60,
    }
    assert SIGN_UP_COOKIE in sent.cookies
    [user_id] = visitor.zitadel.users
    assert visitor.zitadel.codes_sent == [user_id]
    assert visitor.client.get("/api/auth/session").status_code == 401
    landed = visitor.confirm()
    assert landed.status_code == 200, landed.text
    assert landed.json() == {"return_to": "/setup?step=role"}
    assert "samesite=strict" in landed.headers["set-cookie"].lower()
    assert SESSION_COOKIE in visitor.client.cookies
    assert visitor.zitadel.users[user_id].verified
    assert signed_in_subject(visitor) == user_id


def test_a_wrong_code_is_refused_and_a_new_one_can_be_sent(visitor: Visitor) -> None:
    visitor.sign_up()
    wrong = visitor.confirm(code="000000")
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "invalid-code"
    resent = visitor.client.post(
        "/api/auth/sign-up/resend", json={"email": "new.person@example.test"}
    )
    assert resent.status_code == 200, resent.text
    [user_id] = visitor.zitadel.users
    assert visitor.zitadel.codes_sent == [user_id, user_id]
    assert visitor.confirm().status_code == 200


def test_confirming_needs_the_same_browser_and_email(visitor: Visitor) -> None:
    visitor.sign_up()
    other = visitor.confirm(email="someone.else@example.test")
    assert other.json()["code"] == "sign-up-expired"
    visitor.client.cookies.delete(SIGN_UP_COOKIE)
    assert visitor.confirm().json()["code"] == "sign-up-expired"


def test_an_existing_account_is_told_to_sign_in(visitor: Visitor) -> None:
    visitor.zitadel.add_user("taken@example.test", PASSWORD, verified=True)
    taken = visitor.sign_up(email="Taken@example.test")
    assert taken.status_code == 409
    assert taken.json()["code"] == "account-exists"


def test_an_unfinished_sign_up_with_the_same_password_gets_a_new_code(visitor: Visitor) -> None:
    user_id = visitor.zitadel.add_user("halfway@example.test", PASSWORD, verified=False)
    again = visitor.sign_up(email="halfway@example.test")
    assert again.status_code == 200, again.text
    assert visitor.zitadel.codes_sent == [user_id]
    assert len(visitor.zitadel.users) == 1
    stranger = visitor.sign_up(email="halfway@example.test", password="Another-pass-123")
    assert stranger.status_code == 409


def test_sign_up_fields_are_checked(visitor: Visitor) -> None:
    refused = visitor.sign_up(
        name=" ", email="not-an-email", password="short", accepted_terms=False
    )
    assert refused.status_code == 422
    codes = {tuple(issue["location"]): issue["code"] for issue in refused.json()["errors"]}
    assert codes == {
        ("body", "name"): "required",
        ("body", "email"): "invalid-email",
        ("body", "password"): "too-short",
        ("body", "accepted_terms"): "terms-required",
    }
    assert visitor.zitadel.users == {}


def test_a_password_the_identity_provider_refuses_lands_on_the_password_field(
    visitor: Visitor,
) -> None:
    refused = visitor.sign_up(password="lettersanddigits12")
    assert refused.status_code == 422
    [issue] = refused.json()["errors"]
    assert issue["location"] == ["body", "password"]
    assert issue["code"] == "weak-password"


def test_sign_in_with_a_password_opens_a_session(visitor: Visitor) -> None:
    user_id = visitor.zitadel.add_user("known@example.test", PASSWORD, verified=True)
    landed = visitor.sign_in("known@example.test")
    assert landed.status_code == 200, landed.text
    assert landed.json() == {"return_to": "/cases"}
    assert signed_in_subject(visitor) == user_id


def test_a_wrong_password_and_an_unknown_email_look_the_same(visitor: Visitor) -> None:
    visitor.zitadel.add_user("known@example.test", PASSWORD, verified=True)
    wrong = visitor.sign_in("known@example.test", "Not-the-password-1")
    unknown = visitor.sign_in("nobody@example.test")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["code"] == "invalid-credentials"
    assert SESSION_COOKIE not in visitor.client.cookies


def test_an_unverified_email_cannot_sign_in(visitor: Visitor) -> None:
    visitor.zitadel.add_user("halfway@example.test", PASSWORD, verified=False)
    refused = visitor.sign_in("halfway@example.test")
    assert refused.status_code == 403
    assert refused.json()["code"] == "email-unverified"
    assert SESSION_COOKIE not in visitor.client.cookies


def test_sign_in_never_returns_to_another_site(visitor: Visitor) -> None:
    visitor.zitadel.add_user("known@example.test", PASSWORD, verified=True)
    landed = visitor.client.post(
        "/api/auth/sign-in",
        json={"email": "known@example.test", "password": PASSWORD, "return_to": "//evil.test/"},
    )
    assert landed.json() == {"return_to": "/"}
