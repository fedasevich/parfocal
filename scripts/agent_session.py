import argparse
import json
import stat
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import Message
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

REPOSITORY = Path(__file__).resolve().parent.parent
ENVIRONMENTS = REPOSITORY / "infra/app-environments.json"
CONFIG_FOLDER = Path.home() / ".config/parfocal"
CREDENTIALS = CONFIG_FOLDER / "agent-account.env"
STORAGE_STATE = CONFIG_FOLDER / "agent-session.json"
SESSION_COOKIE = "__Host-parfocal_session"
DEVELOPMENT = "development"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
PRIVATE_BITS = stat.S_IRWXG | stat.S_IRWXO
TIMEOUT_SECONDS = 60


class RefusedError(Exception):
    pass


@dataclass(frozen=True)
class Account:
    email: str
    password: str


@dataclass(frozen=True)
class Reply:
    status: int
    headers: Message
    body: bytes


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


OPENER = urllib.request.build_opener(NoRedirects)


def send(url: str, method: str, body: object | None = None, cookie: str | None = None) -> Reply:
    headers = {"Accept": "application/json", "User-Agent": "parfocal-agent-session"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if cookie is not None:
        headers["Cookie"] = f"{SESSION_COOKIE}={cookie}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            return Reply(response.status, response.headers, response.read())
    except urllib.error.HTTPError as error:
        return Reply(error.code, error.headers, error.read())


def development_origin(url: str, environments: dict[str, object]) -> str:
    parts = urlsplit(url)
    host = parts.hostname or ""
    apps = environments.get("apps", {})
    entry = apps.get(host) if isinstance(apps, dict) else None
    declared = entry.get("environment") if isinstance(entry, dict) else None
    if declared != DEVELOPMENT:
        raise RefusedError(
            f"{host or url} is not declared a development environment in {ENVIRONMENTS.name}"
        )
    if parts.scheme != "https" and host not in LOCAL_HOSTS:
        raise RefusedError(f"{host} must be reached over https")
    return f"{parts.scheme}://{parts.netloc}"


def outside_repository(path: Path) -> None:
    if path.resolve().is_relative_to(REPOSITORY):
        raise RefusedError(f"{path} is inside the repository, keep it outside git")


def private_file(path: Path) -> None:
    outside_repository(path)
    if not path.is_file():
        raise RefusedError(f"{path} does not exist, see docs/knowledge/agent-tooling.md")
    if path.stat().st_mode & PRIVATE_BITS:
        raise RefusedError(f"{path} must be readable by you only, run chmod 600 on it")


def account_of(path: Path) -> Account:
    private_file(path)
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and not key.startswith("#"):
            values[key.strip()] = value.strip()
    email = values.get("PARFOCAL_AGENT_EMAIL", "").lower()
    password = values.get("PARFOCAL_AGENT_PASSWORD", "")
    if not email or not password:
        raise RefusedError(f"{path} needs PARFOCAL_AGENT_EMAIL and PARFOCAL_AGENT_PASSWORD")
    return Account(email, password)


def seeded_account(account: Account, environments: dict[str, object]) -> None:
    listed = environments.get("test_accounts", [])
    allowed = {str(item).lower() for item in listed} if isinstance(listed, list) else set()
    if account.email not in allowed:
        raise RefusedError(f"{account.email} is not a seeded test account")


def session_cookie(reply: Reply) -> tuple[str, int | None]:
    for header in reply.headers.get_all("Set-Cookie") or []:
        jar = SimpleCookie()
        jar.load(header)
        morsel = jar.get(SESSION_COOKIE)
        if morsel is not None and morsel.value:
            max_age = morsel["max-age"]
            return morsel.value, int(max_age) if max_age else None
    raise RefusedError("the sign-in answered without a session cookie")


def problem_title(reply: Reply) -> str:
    try:
        title = json.loads(reply.body).get("title")
    except ValueError, AttributeError:
        title = None
    return f"{reply.status} {title}" if title else str(reply.status)


def seeded_workspaces(origin: str, cookie: str, environments: dict[str, object]) -> list[str]:
    reply = send(f"{origin}/api/me", "GET", cookie=cookie)
    if reply.status != 200:
        raise RefusedError(f"/api/me answered {problem_title(reply)}")
    slugs = sorted(str(item.get("slug")) for item in json.loads(reply.body).get("workspaces", []))
    listed = environments.get("seeded_workspaces", [])
    allowed = set(listed) if isinstance(listed, list) else set()
    strange = [slug for slug in slugs if slug not in allowed]
    if not slugs or strange:
        send(f"{origin}/api/auth/logout", "GET", cookie=cookie)
        found = ", ".join(strange) or "no workspace"
        raise RefusedError(f"the account belongs to {found}, not only to seeded workspaces")
    return slugs


def storage_state(origin: str, cookie: str, max_age: int | None) -> dict[str, object]:
    host = urlsplit(origin).hostname or ""
    expires = -1 if max_age is None else int(time.time()) + max_age
    return {
        "cookies": [
            {
                "name": SESSION_COOKIE,
                "value": cookie,
                "domain": host,
                "path": "/",
                "expires": expires,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Strict",
            }
        ],
        "origins": [],
    }


def write_private(path: Path, content: str) -> None:
    outside_repository(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(content)


def mint(url: str, credentials: Path, out: Path, environments_path: Path = ENVIRONMENTS) -> str:
    environments = json.loads(environments_path.read_text())
    origin = development_origin(url, environments)
    outside_repository(out)
    account = account_of(credentials)
    seeded_account(account, environments)
    reply = send(
        f"{origin}/api/auth/sign-in",
        "POST",
        {"email": account.email, "password": account.password, "return_to": "/"},
    )
    if reply.status != 200:
        raise RefusedError(f"the sign-in answered {problem_title(reply)}")
    cookie, max_age = session_cookie(reply)
    slugs = seeded_workspaces(origin, cookie, environments)
    write_private(out, json.dumps(storage_state(origin, cookie, max_age), indent=2))
    return f"signed in as {account.email} on {origin} in {', '.join(slugs)}, session saved to {out}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="agent_session",
        description="Sign a seeded test account in to a development deployment and save "
        "a Playwright storage state, without a browser and without printing the password",
    )
    parser.add_argument("--url", default="https://app.parfocal.eu")
    parser.add_argument("--credentials", type=Path, default=CREDENTIALS)
    parser.add_argument("--out", type=Path, default=STORAGE_STATE)
    parser.add_argument("--environments", type=Path, default=ENVIRONMENTS)
    args = parser.parse_args(argv)
    try:
        print(mint(args.url, args.credentials, args.out, args.environments))
    except RefusedError as error:
        print(f"agent_session refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
