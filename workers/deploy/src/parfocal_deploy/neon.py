import json
import re
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

API = "https://console.neon.tech/api/v2"
APP_ROLE = "parfocal_app"
SAFE_PASSWORD = re.compile(r"[A-Za-z0-9_-]{32,}")
TIMEOUT_SECONDS = 60

Transport = Callable[[str, str, dict[str, Any] | None], dict[str, Any]]


class UnsafePasswordError(Exception):
    def __init__(self) -> None:
        super().__init__("the app role password must be 32 or more URL-safe characters")


class NoDatabaseError(Exception):
    def __init__(self, branch: str) -> None:
        super().__init__(f"the Neon branch {branch} has no database")


@dataclass(frozen=True)
class Branch:
    id: str
    name: str


@dataclass(frozen=True)
class Database:
    name: str
    owner: str


def http_transport(api_key: str) -> Transport:
    def send(method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{API}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read())

    return send


def find_branch(send: Transport, project: str, name: str) -> Branch | None:
    listed = send("GET", f"/projects/{project}/branches", None)
    for branch in listed["branches"]:
        if branch["name"] == name:
            return Branch(id=branch["id"], name=branch["name"])
    return None


def ensure_branch(send: Transport, project: str, name: str) -> Branch:
    found = find_branch(send, project, name)
    if found is not None:
        return found
    created = send(
        "POST",
        f"/projects/{project}/branches",
        {"branch": {"name": name}, "endpoints": [{"type": "read_write"}]},
    )
    return Branch(id=created["branch"]["id"], name=created["branch"]["name"])


def first_database(send: Transport, project: str, branch: Branch) -> Database:
    listed = send("GET", f"/projects/{project}/branches/{branch.id}/databases", None)
    if not listed["databases"]:
        raise NoDatabaseError(branch.name)
    database = listed["databases"][0]
    return Database(name=database["name"], owner=database["owner_name"])


def owner_uri(
    send: Transport, project: str, branch: Branch, database: Database, *, pooled: bool
) -> str:
    query = urlencode(
        {
            "branch_id": branch.id,
            "database_name": database.name,
            "role_name": database.owner,
            "pooled": "true" if pooled else "false",
        }
    )
    return str(send("GET", f"/projects/{project}/connection_uri?{query}", None)["uri"])


def checked(password: str) -> str:
    if SAFE_PASSWORD.fullmatch(password) is None:
        raise UnsafePasswordError
    return password


def app_uri(pooled_owner_uri: str, password: str) -> str:
    parts = urlsplit(pooled_owner_uri)
    port = "" if parts.port is None else f":{parts.port}"
    netloc = f"{APP_ROLE}:{quote(checked(password), safe='')}@{parts.hostname}{port}"
    return urlunsplit(parts._replace(netloc=netloc))


ROLE_EXISTS = f"SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}'"


def create_role_statements(database: str, password: str) -> list[str]:
    return [
        f"CREATE ROLE {APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "
        f"PASSWORD '{checked(password)}'",
        f'GRANT CONNECT ON DATABASE "{database}" TO {APP_ROLE}',
        f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}",
    ]


def reset_password_statement(password: str) -> str:
    return f"ALTER ROLE {APP_ROLE} PASSWORD '{checked(password)}'"
