import base64
import json
import secrets
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr
from test_password_login import (
    LOGIN_CLIENT,
    LOGIN_TOKEN,
    PASSWORD,
    FakeZitadel,
    Visitor,
    signed_in_subject,
    visiting,
)

from parfocal_api.auth import SESSION_COOKIE
from parfocal_api.passkeys import PASSKEY_COOKIE

pytestmark = pytest.mark.db

RP_ID = "localhost"
ORIGIN = "http://localhost:5173"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def client_data(kind: str, challenge: str) -> str:
    return b64(json.dumps({"type": kind, "challenge": challenge, "origin": ORIGIN}).encode())


def challenge_of(credential: dict[str, Any]) -> tuple[str, str]:
    raw = credential["response"]["clientDataJSON"]
    data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    return str(data["type"]), str(data["challenge"])


@dataclass
class Passkey:
    challenge: str
    name: str = ""
    credential_id: str | None = None


@dataclass
class PasskeyZitadel(FakeZitadel):
    passkeys: dict[str, dict[str, Passkey]] = field(default_factory=dict[str, dict[str, Passkey]])
    challenges: dict[str, tuple[str, str]] = field(default_factory=dict[str, tuple[str, str]])
    domains: list[str] = field(default_factory=list[str])

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        parts = request.url.path.strip("/").split("/")
        authorized = request.headers.get("authorization") == f"Bearer {LOGIN_TOKEN}"
        if parts[0] != "v2" or not authorized:
            return super().handle(request)
        body: dict[str, Any] = json.loads(request.content or b"{}")
        match parts:
            case ["v2", "users", user_id, "passkeys", *rest]:
                return self.passkey_call(user_id, rest, body)
            case ["v2", "sessions"] if "challenges" in body:
                return self.challenge(body)
            case ["v2", "sessions", session_id] if request.method == "PATCH":
                return self.assert_passkey(session_id, body)
            case _:
                return super().handle(request)

    def passkey_call(self, user_id: str, rest: list[str], body: dict[str, Any]) -> httpx2.Response:
        owned = self.passkeys.setdefault(user_id, {})
        match rest:
            case ["registration_link"]:
                return httpx2.Response(200, json={"code": {"id": "c1", "code": "secret"}})
            case []:
                assert body["code"] == {"id": "c1", "code": "secret"}
                self.domains.append(body["domain"])
                passkey_id = secrets.token_hex(4)
                owned[passkey_id] = Passkey(b64(secrets.token_bytes(16)))
                options = {"challenge": owned[passkey_id].challenge, "rp": {"id": body["domain"]}}
                return httpx2.Response(
                    200,
                    json={
                        "passkeyId": passkey_id,
                        "publicKeyCredentialCreationOptions": {"publicKey": options},
                    },
                )
            case ["_search"]:
                result = [
                    {"id": key, "name": item.name, "state": "AUTH_FACTOR_STATE_READY"}
                    for key, item in owned.items()
                    if item.credential_id
                ]
                return httpx2.Response(200, json={"result": result})
            case [passkey_id]:
                passkey = owned.get(passkey_id)
                credential = body["publicKeyCredential"]
                if passkey is None or challenge_of(credential) != (
                    "webauthn.create",
                    passkey.challenge,
                ):
                    return httpx2.Response(400, json={"code": 3, "message": "not verified"})
                passkey.credential_id = credential["id"]
                passkey.name = body["passkeyName"]
                return httpx2.Response(200, json={})
            case _:
                return httpx2.Response(404, json={})

    def challenge(self, body: dict[str, Any]) -> httpx2.Response:
        user_id = body["checks"]["user"]["userId"]
        self.domains.append(body["challenges"]["webAuthN"]["domain"])
        session_id = secrets.token_hex(6)
        token = secrets.token_urlsafe(12)
        self.sessions[session_id] = (token, user_id)
        challenge = b64(secrets.token_bytes(16))
        self.challenges[session_id] = (user_id, challenge)
        allowed = [
            {"id": item.credential_id, "type": "public-key"}
            for item in self.passkeys.get(user_id, {}).values()
            if item.credential_id
        ]
        options = {"challenge": challenge, "rpId": RP_ID, "allowCredentials": allowed}
        return httpx2.Response(
            201,
            json={
                "sessionId": session_id,
                "sessionToken": token,
                "challenges": {
                    "webAuthN": {"publicKeyCredentialRequestOptions": {"publicKey": options}}
                },
            },
        )

    def assert_passkey(self, session_id: str, body: dict[str, Any]) -> httpx2.Response:
        user_id, challenge = self.challenges[session_id]
        assertion = body["checks"]["webAuthN"]["credentialAssertionData"]
        known = {item.credential_id for item in self.passkeys.get(user_id, {}).values()}
        if assertion["id"] not in known or challenge_of(assertion) != ("webauthn.get", challenge):
            return httpx2.Response(400, json={"code": 3, "message": "assertion invalid"})
        token = secrets.token_urlsafe(12)
        self.sessions[session_id] = (token, user_id)
        return httpx2.Response(200, json={"sessionToken": token})


@pytest.fixture
def visitor(database: str) -> Iterator[Visitor]:
    yield from visiting(
        database,
        PasskeyZitadel(),
        zitadel_login_client_id=LOGIN_CLIENT,
        zitadel_login_token=SecretStr(LOGIN_TOKEN),
    )


def zitadel_of(visitor: Visitor) -> PasskeyZitadel:
    assert isinstance(visitor.zitadel, PasskeyZitadel)
    return visitor.zitadel


def password_sign_in(visitor: Visitor, email: str) -> None:
    landed = visitor.client.post("/api/auth/sign-in", json={"email": email, "password": PASSWORD})
    assert landed.status_code == 200, landed.text


def save_passkey(visitor: Visitor, credential_id: str = "cred-1") -> httpx2.Response:
    started = visitor.client.post("/api/auth/passkeys/registration")
    assert started.status_code == 200, started.text
    creation = started.json()
    credential = {
        "id": credential_id,
        "rawId": credential_id,
        "type": "public-key",
        "response": {
            "clientDataJSON": client_data("webauthn.create", creation["options"]["challenge"]),
            "attestationObject": "o2NmbXRkbm9uZQ",
        },
    }
    return visitor.client.post(
        "/api/auth/passkeys",
        json={"passkey": creation["passkey"], "name": "Mac", "credential": credential},
    )


def assertion(credential_id: str, challenge: str) -> dict[str, Any]:
    return {
        "id": credential_id,
        "rawId": credential_id,
        "type": "public-key",
        "response": {
            "clientDataJSON": client_data("webauthn.get", challenge),
            "authenticatorData": "AAAA",
            "signature": "AAAA",
            "userHandle": b64(b"user"),
        },
    }


def test_a_signed_in_person_saves_a_passkey_for_the_app_origin(visitor: Visitor) -> None:
    zitadel = zitadel_of(visitor)
    user_id = zitadel.add_user("known@example.test", PASSWORD, verified=True)
    password_sign_in(visitor, "known@example.test")
    assert visitor.client.get("/api/auth/passkeys").json() == []
    saved = save_passkey(visitor)
    assert saved.status_code == 200, saved.text
    assert saved.json()["name"] == "Mac"
    assert zitadel.domains == [RP_ID]
    listed = visitor.client.get("/api/auth/passkeys").json()
    assert [item["name"] for item in listed] == ["Mac"]
    assert list(zitadel.passkeys) == [user_id]


def test_a_passkey_answering_another_challenge_is_not_saved(visitor: Visitor) -> None:
    zitadel = zitadel_of(visitor)
    zitadel.add_user("known@example.test", PASSWORD, verified=True)
    password_sign_in(visitor, "known@example.test")
    started = visitor.client.post("/api/auth/passkeys/registration").json()
    credential = {
        "id": "cred-x",
        "response": {"clientDataJSON": client_data("webauthn.create", "other")},
    }
    refused = visitor.client.post(
        "/api/auth/passkeys",
        json={"passkey": started["passkey"], "credential": credential},
    )
    assert refused.status_code == 401
    assert refused.json()["code"] == "passkey-refused"


def test_saving_a_passkey_needs_a_session(visitor: Visitor) -> None:
    assert visitor.client.post("/api/auth/passkeys/registration").status_code == 401
    assert visitor.client.get("/api/auth/passkeys").status_code == 401


def test_sign_in_with_a_saved_passkey_opens_a_session(visitor: Visitor) -> None:
    zitadel = zitadel_of(visitor)
    user_id = zitadel.add_user("known@example.test", PASSWORD, verified=True)
    password_sign_in(visitor, "known@example.test")
    assert save_passkey(visitor, "cred-1").status_code == 200
    visitor.client.cookies.clear()
    started = visitor.client.post("/api/auth/passkey-sign-in", json={"email": "Known@example.test"})
    assert started.status_code == 200, started.text
    options = started.json()["options"]
    assert options["allowCredentials"] == [{"id": "cred-1", "type": "public-key"}]
    assert PASSKEY_COOKIE in visitor.client.cookies
    landed = visitor.client.post(
        "/api/auth/passkey-sign-in/finish",
        json={"credential": assertion("cred-1", options["challenge"]), "return_to": "/cases"},
    )
    assert landed.status_code == 200, landed.text
    assert landed.json() == {"return_to": "/cases"}
    assert SESSION_COOKIE in visitor.client.cookies
    assert signed_in_subject(visitor) == user_id


def test_a_wrong_passkey_leaves_the_person_signed_out(visitor: Visitor) -> None:
    zitadel = zitadel_of(visitor)
    zitadel.add_user("known@example.test", PASSWORD, verified=True)
    password_sign_in(visitor, "known@example.test")
    save_passkey(visitor, "cred-1")
    visitor.client.cookies.clear()
    options = visitor.client.post(
        "/api/auth/passkey-sign-in", json={"email": "known@example.test"}
    ).json()["options"]
    refused = visitor.client.post(
        "/api/auth/passkey-sign-in/finish",
        json={"credential": assertion("cred-2", options["challenge"])},
    )
    assert refused.status_code == 401
    assert refused.json()["code"] == "passkey-refused"
    assert SESSION_COOKIE not in visitor.client.cookies


def test_an_email_without_a_passkey_is_told_to_use_the_password(visitor: Visitor) -> None:
    zitadel_of(visitor).add_user("known@example.test", PASSWORD, verified=True)
    for email in ("known@example.test", "nobody@example.test"):
        refused = visitor.client.post("/api/auth/passkey-sign-in", json={"email": email})
        assert refused.status_code == 404
        assert refused.json()["code"] == "no-passkey"


def test_finishing_needs_the_challenge_from_the_same_browser(visitor: Visitor) -> None:
    refused = visitor.client.post(
        "/api/auth/passkey-sign-in/finish", json={"credential": assertion("cred-1", "x")}
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "passkey-expired"
