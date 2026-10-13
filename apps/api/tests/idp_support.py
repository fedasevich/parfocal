import base64
import hashlib
import secrets
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx2
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from db_support import OWNER_URL, api_settings, query, with_database
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from parfocal_api.app import create_app
from parfocal_api.oidc import OidcClient

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


@contextmanager
def signed_in_browser(database: str) -> Generator[Browser]:
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
