import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import agent_session

USER_AGENT = "parfocal-agent-session"
TIMEOUT_SECONDS = 90


class SessionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Answer:
    status: int
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


@dataclass(frozen=True)
class Client:
    origin: str
    cookie: str | None

    def send(self, path: str, method: str = "GET", body: object | None = None) -> Answer:
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if self.cookie is not None:
            headers["Cookie"] = f"{agent_session.SESSION_COOKIE}={self.cookie}"
        request = urllib.request.Request(
            self.origin + path, data=data, headers=headers, method=method
        )
        try:
            with agent_session.OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
                return Answer(response.status, response.read())
        except urllib.error.HTTPError as error:
            return Answer(error.code, error.read())
        except (urllib.error.URLError, TimeoutError) as error:
            return Answer(0, str(error).encode())

    def json(self, path: str) -> Any:
        answer = self.send(path)
        if answer.status != 200:
            raise SessionError(f"{path} answered {answer.status}")
        return answer.json()


def session_file(role: str) -> Path:
    return agent_session.STORAGE_STATE if role == "owner" else agent_session.role_session(role)


def saved_cookie(path: Path) -> str | None:
    if not path.is_file():
        return None
    cookies = json.loads(path.read_text()).get("cookies", [])
    return str(cookies[0]["value"]) if cookies else None


def sign_in(origin: str, role: str) -> None:
    credentials = agent_session.CREDENTIALS if role == "owner" else agent_session.ROLE_CREDENTIALS
    agent_session.mint(
        origin, credentials, session_file(role), role=None if role == "owner" else role
    )


def client_for(origin: str, role: str, fresh: bool = False) -> Client:
    if role == "signed-out":
        return Client(origin, None)
    path = session_file(role)
    cookie = None if fresh else saved_cookie(path)
    if cookie is not None and Client(origin, cookie).send("/api/me").status == 200:
        return Client(origin, cookie)
    try:
        sign_in(origin, role)
    except agent_session.RefusedError as error:
        raise SessionError(f"{role} could not sign in: {error}") from error
    cookie = saved_cookie(path)
    if cookie is None:
        raise SessionError(f"{role} has no saved session")
    return Client(origin, cookie)


def use_workspace(client: Client, slug: str) -> str:
    me = client.json("/api/me")
    chosen = next((item for item in me.get("workspaces", []) if item.get("slug") == slug), None)
    if chosen is None:
        raise SessionError(f"the account is not a member of {slug}")
    tenant = str(chosen["tenant_id"])
    if me.get("active_tenant_id") != tenant:
        answer = client.send("/api/me/workspace", "PUT", {"tenant_id": tenant})
        if answer.status >= 300:
            raise SessionError(f"switching to {slug} answered {answer.status}")
    return tenant
