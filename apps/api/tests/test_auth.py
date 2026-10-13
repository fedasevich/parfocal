import base64
import hashlib
import re
import secrets
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from db_support import APP_URL, OWNER_URL, api_settings, query, with_database
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from parfocal_api import operators
from parfocal_api.app import create_app
from parfocal_api.auth import LOGIN_COOKIE, SESSION_COOKIE
from parfocal_api.oidc import OidcClient

pytestmark = pytest.mark.db

ISSUER = "https://idp.test"
CLIENT_ID = "parfocal-api-test"
CLIENT_SECRET = "client-secret"
ORIGIN = "http://localhost:5173"


@dataclass
class Grant:
    nonce: str
    challenge: str
    subject: str


@dataclass
class FakeIdp:
    key: rsa.RSAPrivateKey = field(
        default_factory=lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)
    )
    kid: str = "key-1"
    expires_in: int = 43200
    subject: str = "user-1"
    codes: dict[str, Grant] = field(default_factory=dict[str, Grant])
    refresh_tokens: dict[str, str] = field(default_factory=dict[str, str])
    refreshes: int = 0
    revoked: list[str] = field(default_factory=list[str])
    claim_overrides: dict[str, Any] = field(default_factory=dict[str, Any])
    signing_key: rsa.RSAPrivateKey | None = None
    signing_kid: str | None = None

    def jwks(self) -> dict[str, Any]:
        public = RSAAlgorithm.to_jwk(self.key.public_key(), as_dict=True)
        return {"keys": [public | {"kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def id_token(self, subject: str, nonce: str | None) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": ISSUER,
            "aud": CLIENT_ID,
            "sub": subject,
            "iat": now,
            "exp": now + 3600,
            "name": "Test Pathologist",
            "email": "pathologist@example.test",
        }
        if nonce is not None:
            claims["nonce"] = nonce
        claims |= self.claim_overrides
        return jwt.encode(
            claims,
            self.signing_key or self.key,
            algorithm="RS256",
            headers={"kid": self.signing_kid or self.kid},
        )

    def tokens(self, subject: str, nonce: str | None) -> dict[str, Any]:
        refresh_token = secrets.token_urlsafe(16)
        self.refresh_tokens[refresh_token] = subject
        return {
            "access_token": "opaque",
            "id_token": self.id_token(subject, nonce),
            "refresh_token": refresh_token,
            "expires_in": self.expires_in,
            "token_type": "Bearer",
        }

    def authorize(self, url: str) -> str:
        query = parse_qs(urlparse(url).query)
        assert query["client_id"] == [CLIENT_ID]
        assert query["code_challenge_method"] == ["S256"]
        code = secrets.token_urlsafe(16)
        self.codes[code] = Grant(query["nonce"][0], query["code_challenge"][0], self.subject)
        return code

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx2.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/keys",
                    "end_session_endpoint": f"{ISSUER}/end_session",
                    "revocation_endpoint": f"{ISSUER}/revoke",
                },
            )
        if path == "/keys":
            return httpx2.Response(200, json=self.jwks())
        expected = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
        if request.headers.get("authorization") != f"Basic {expected}":
            return httpx2.Response(401, json={"error": "invalid_client"})
        form = {name: values[0] for name, values in parse_qs(request.content.decode()).items()}
        if path == "/revoke":
            self.refresh_tokens.pop(form["token"], None)
            self.revoked.append(form["token"])
            return httpx2.Response(200)
        if form["grant_type"] == "authorization_code":
            grant = self.codes.pop(form["code"], None)
            hashed = hashlib.sha256(form["code_verifier"].encode()).digest()
            challenge = base64.urlsafe_b64encode(hashed).rstrip(b"=").decode()
            if grant is None or challenge != grant.challenge:
                return httpx2.Response(400, json={"error": "invalid_grant"})
            return httpx2.Response(200, json=self.tokens(grant.subject, grant.nonce))
        subject = self.refresh_tokens.pop(form["refresh_token"], None)
        if subject is None:
            return httpx2.Response(400, json={"error": "invalid_request"})
        self.refreshes += 1
        return httpx2.Response(200, json=self.tokens(subject, None))


@dataclass
class Browser:
    client: TestClient
    idp: FakeIdp
    owner_url: str

    def login(self, return_to: str = "/cases/S26-0001") -> httpx2.Response:
        started = self.client.get("/api/auth/login", params={"return_to": return_to})
        assert started.status_code == 302
        location = started.headers["location"]
        code = self.idp.authorize(location)
        state = parse_qs(urlparse(location).query)["state"][0]
        return self.client.get("/api/auth/callback", params={"code": code, "state": state})

    def session(self) -> httpx2.Response:
        return self.client.get("/api/auth/session")

    def sql(self, statement: str) -> list[tuple[object, ...]]:
        return query(self.owner_url, statement)


@pytest.fixture
def browser(database: str) -> Iterator[Browser]:
    idp = FakeIdp(subject=f"user-{secrets.token_hex(6)}")
    settings = api_settings(database)
    identity = OidcClient(
        issuer=ISSUER,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=f"{ORIGIN}/api/auth/callback",
        http=httpx2.AsyncClient(transport=httpx2.MockTransport(idp.handle)),
    )
    app = create_app(settings, identity=identity)
    with TestClient(app, base_url="https://testserver", follow_redirects=False) as client:
        yield Browser(client, idp, with_database(OWNER_URL, database))


def hop_target(response: httpx2.Response) -> str:
    match = re.search(r'url=([^"]+)"', response.text)
    assert match is not None, response.text
    return match.group(1)


def set_cookie_header(response: httpx2.Response, name: str) -> str:
    headers = [value for value in response.headers.get_list("set-cookie") if value.startswith(name)]
    assert len(headers) == 1, headers
    return headers[0]


def test_login_sets_a_strict_session_and_returns_to_the_deep_link(browser: Browser) -> None:
    landed = browser.login("/cases/S26-0001?slide=2")
    assert landed.status_code == 200
    assert hop_target(landed) == "/cases/S26-0001?slide=2"
    cookie = set_cookie_header(landed, SESSION_COOKIE).lower()
    for attribute in ("httponly", "secure", "samesite=strict", "path=/"):
        assert attribute in cookie
    assert f"{LOGIN_COOKIE.lower()}=" in set_cookie_header(landed, LOGIN_COOKIE).lower()
    session = browser.session()
    assert session.status_code == 200
    assert session.json() == {
        "subject": browser.idp.subject,
        "name": "Test Pathologist",
        "email": "pathologist@example.test",
        "operator": False,
    }


def test_the_login_binding_cookie_is_lax(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    cookie = set_cookie_header(started, LOGIN_COOKIE).lower()
    assert "samesite=lax" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie


@pytest.mark.parametrize(
    "unsafe",
    ["https://evil.test/", "//evil.test/", "/\\evil.test", "javascript:alert(1)", "/a\nb"],
)
def test_login_never_returns_to_another_site(browser: Browser, unsafe: str) -> None:
    assert hop_target(browser.login(unsafe)) == "/"


def test_the_callback_needs_the_binding_cookie(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    location = started.headers["location"]
    code = browser.idp.authorize(location)
    state = parse_qs(urlparse(location).query)["state"][0]
    browser.client.cookies.clear()
    refused = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert refused.status_code == 400
    assert refused.json()["code"] == "login-failed"


def test_a_state_works_once(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    location = started.headers["location"]
    state = parse_qs(urlparse(location).query)["state"][0]
    code = browser.idp.authorize(location)
    first = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert first.is_success
    browser.client.get("/api/auth/login")
    again = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert again.status_code == 400


def test_an_unknown_state_is_refused(browser: Browser) -> None:
    browser.client.get("/api/auth/login")
    refused = browser.client.get("/api/auth/callback", params={"code": "x", "state": "unknown"})
    assert refused.status_code == 400


@pytest.mark.parametrize(
    "tampered",
    [
        {"nonce": "another-nonce"},
        {"aud": "another-client"},
        {"iss": "https://another-issuer.test"},
        {"exp": 1},
    ],
)
def test_an_id_token_that_fails_verification_is_refused(
    browser: Browser, tampered: dict[str, Any]
) -> None:
    browser.idp.claim_overrides = tampered
    refused = browser.login()
    assert refused.status_code == 400
    assert refused.json()["code"] == "login-failed"
    assert browser.session().status_code == 401


def test_a_token_signed_with_an_unknown_key_is_refused(browser: Browser) -> None:
    browser.idp.signing_kid = "unpublished"
    assert browser.login().status_code == 400


def test_a_token_with_a_forged_signature_is_refused(browser: Browser) -> None:
    browser.idp.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert browser.login().status_code == 400


def test_an_expired_access_token_is_refreshed_without_the_page_noticing(browser: Browser) -> None:
    browser.idp.expires_in = 0
    browser.login()
    first_refresh_token = next(iter(browser.idp.refresh_tokens))
    assert browser.session().status_code == 200
    assert browser.idp.refreshes == 1
    assert first_refresh_token not in browser.idp.refresh_tokens
    assert browser.session().status_code == 200
    assert browser.idp.refreshes == 2


def test_a_refused_refresh_ends_the_session(browser: Browser) -> None:
    browser.idp.expires_in = 0
    browser.login()
    browser.idp.refresh_tokens.clear()
    assert browser.session().status_code == 401
    assert browser.sql(
        f"SELECT count(*) FROM sessions WHERE subject = '{browser.idp.subject}'"
    ) == [(0,)]


def test_logout_revokes_and_ends_the_session_at_the_idp(browser: Browser) -> None:
    browser.login()
    refresh_token = next(iter(browser.idp.refresh_tokens))
    out = browser.client.get("/api/auth/logout")
    assert out.status_code == 302
    location = urlparse(out.headers["location"])
    params = parse_qs(location.query)
    assert f"{location.scheme}://{location.netloc}{location.path}" == f"{ISSUER}/end_session"
    assert params["post_logout_redirect_uri"] == [f"{ORIGIN}/"]
    assert "id_token_hint" in params
    assert browser.idp.revoked == [refresh_token]
    assert f'{SESSION_COOKIE}=""' in set_cookie_header(out, SESSION_COOKIE)
    browser.client.cookies.set(SESSION_COOKIE, "stale", domain="testserver")
    assert browser.session().status_code == 401


def test_logout_without_a_session_goes_home(browser: Browser) -> None:
    out = browser.client.get("/api/auth/logout")
    assert out.headers["location"] == f"{ORIGIN}/"


def test_an_expired_session_is_refused(browser: Browser) -> None:
    browser.login()
    browser.sql(
        "UPDATE sessions SET expires_at = now() - interval '1 second' "
        f"WHERE subject = '{browser.idp.subject}'"
    )
    assert browser.session().status_code == 401


def test_a_forged_session_cookie_is_refused(browser: Browser) -> None:
    browser.client.cookies.set(SESSION_COOKIE, secrets.token_urlsafe(32), domain="testserver")
    assert browser.session().status_code == 401


def test_secrets_are_not_stored_in_the_clear(browser: Browser) -> None:
    landed = browser.login()
    session_id = set_cookie_header(landed, SESSION_COOKIE).split(";")[0].split("=", 1)[1]
    refresh_token = next(iter(browser.idp.refresh_tokens))
    dump = str(browser.sql("SELECT id_hash, subject, tokens FROM sessions"))
    assert browser.idp.subject in dump
    logins = str(browser.sql("SELECT * FROM auth_logins"))
    assert session_id not in dump
    assert refresh_token not in dump
    assert "pathologist@example.test" not in dump
    assert session_id not in logins


def test_a_platform_operator_reaches_platform_routes(browser: Browser) -> None:
    operator = browser.idp.subject
    browser.sql(f"INSERT INTO platform_operators (subject) VALUES ('{operator}')")
    browser.login()
    assert browser.session().json()["operator"] is True
    assert browser.client.get("/api/platform/tenants").status_code == 200
    browser.sql(f"DELETE FROM platform_operators WHERE subject = '{operator}'")
    assert browser.client.get("/api/platform/tenants").status_code == 403


def test_a_user_without_a_workspace_is_kept_out_of_tenant_routes(browser: Browser) -> None:
    browser.login()
    assert browser.client.get("/api/tenant").status_code == 403
    assert browser.client.get("/api/platform/tenants").status_code == 403


async def test_the_operator_tool_adds_lists_and_removes(database: str) -> None:
    url = with_database(APP_URL, database)
    subject = f"operator-{secrets.token_hex(6)}"
    assert subject in await operators.run(url, "add", subject)
    assert subject not in await operators.run(url, "remove", subject)
