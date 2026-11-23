import argparse
import json
import secrets
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import jwt
from agent_session import (
    ROLE_CREDENTIALS,
    ROLES,
    RefusedError,
    outside_repository,
    role_keys,
    write_private,
)

ISSUER = "https://parfocal-iqcyh5.eu1.zitadel.cloud"
SERVICE_KEY = Path.home() / ".config/parfocal/zitadel-sa.json"
MODEL_ACCOUNT = "agent-walk@parfocal.eu"
DOMAIN = "parfocal.eu"
SCOPE = "openid urn:zitadel:iam:org:project:id:zitadel:aud"
JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
PASSWORD_BYTES = 24
SYMBOLS = "!#%+:?@^"
TIMEOUT_SECONDS = 60

type Call = Callable[[str, str, dict[str, object]], dict[str, object]]


@dataclass(frozen=True)
class RoleAccount:
    role: str
    email: str

    @property
    def seed_role(self) -> str:
        return self.role.split("-")[0]

    @property
    def given_name(self) -> str:
        return " ".join(word.capitalize() for word in self.role.split("-"))


def role_accounts(domain: str = DOMAIN) -> list[RoleAccount]:
    return [RoleAccount(role, f"role-{role}@{domain}") for role in ROLES]


def seed_role_emails(accounts: list[RoleAccount]) -> str:
    return ",".join(f"{account.seed_role}={account.email}" for account in accounts)


def read_values(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and not key.startswith("#"):
            values[key.strip()] = value.strip()
    return values


def write_values(path: Path, values: dict[str, str]) -> None:
    write_private(path, "".join(f"{key}={value}\n" for key, value in values.items()))


def service_token(issuer: str, key_file: Path) -> str:
    key = json.loads(key_file.read_text())
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": key["userId"], "sub": key["userId"], "aud": issuer, "iat": now, "exp": now + 600},
        key["key"],
        algorithm="RS256",
        headers={"kid": key["keyId"]},
    )
    body = urllib.parse.urlencode(
        {"grant_type": JWT_BEARER, "scope": SCOPE, "assertion": assertion}
    ).encode()
    request = urllib.request.Request(f"{issuer}/oauth/v2/token", data=body, method="POST")
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return str(json.loads(response.read())["access_token"])


def api(issuer: str, token: str) -> Call:
    def call(method: str, path: str, body: dict[str, object]) -> dict[str, object]:
        request = urllib.request.Request(
            f"{issuer}{path}",
            data=json.dumps(body).encode(),
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return dict(json.loads(response.read() or b"{}"))
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read()).get("message", "")
            except ValueError, AttributeError:
                message = ""
            raise RefusedError(
                f"Zitadel answered {error.code} on {method} {path} {message}".rstrip()
            ) from error

    return call


def find_user(call: Call, email: str) -> dict[str, object] | None:
    found = call(
        "POST",
        "/v2/users",
        {
            "queries": [
                {
                    "emailQuery": {
                        "emailAddress": email,
                        "method": "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
                    }
                }
            ]
        },
    )
    listed = found.get("result") or []
    return dict(listed[0]) if isinstance(listed, list) and listed else None


def organisation_of(user: dict[str, object]) -> str:
    details = user.get("details")
    owner = details.get("resourceOwner") if isinstance(details, dict) else None
    if not owner:
        raise RefusedError("the model account has no organisation in Zitadel's answer")
    return str(owner)


def new_password() -> str:
    classes = (string.ascii_uppercase, string.ascii_lowercase, string.digits, SYMBOLS)
    return secrets.token_urlsafe(PASSWORD_BYTES) + "".join(
        secrets.choice(characters) for characters in classes
    )


def create_user(call: Call, organisation: str, account: RoleAccount, password: str) -> str:
    made = call(
        "POST",
        "/v2/users/human",
        {
            "username": account.email,
            "organization": {"orgId": organisation},
            "profile": {"givenName": account.given_name, "familyName": "Role"},
            "email": {"email": account.email, "isVerified": True},
            "password": {"password": password, "changeRequired": False},
        },
    )
    return str(made.get("userId", ""))


def ensure(
    call: Call,
    credentials: Path,
    accounts: list[RoleAccount],
    model: str = MODEL_ACCOUNT,
    make_password: Callable[[], str] = new_password,
) -> list[str]:
    outside_repository(credentials)
    model_user = find_user(call, model)
    if model_user is None:
        raise RefusedError(f"{model} is not in Zitadel, so the organisation is unknown")
    organisation = organisation_of(model_user)
    values = read_values(credentials)
    said: list[str] = []
    for account in accounts:
        email_key, password_key = role_keys(account.role)
        existing = find_user(call, account.email)
        if existing is not None:
            if values.get(email_key) == account.email and values.get(password_key):
                said.append(f"{account.role}: {account.email} exists, kept")
            else:
                said.append(
                    f"{account.role}: {account.email} exists without a password in "
                    f"{credentials.name}, left alone"
                )
            continue
        values[email_key] = account.email
        values[password_key] = make_password()
        write_values(credentials, values)
        create_user(call, organisation, account, values[password_key])
        said.append(f"{account.role}: {account.email} created")
    return said


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="zitadel_role_accounts",
        description="Create the seeded role test accounts in Zitadel when they are missing, "
        "keep their passwords in a private file and never change an existing user",
    )
    parser.add_argument("--issuer", default=ISSUER)
    parser.add_argument("--key", type=Path, default=SERVICE_KEY)
    parser.add_argument("--credentials", type=Path, default=ROLE_CREDENTIALS)
    parser.add_argument("--model", default=MODEL_ACCOUNT)
    args = parser.parse_args(argv)
    accounts = role_accounts()
    try:
        call = api(args.issuer, service_token(args.issuer, args.key))
        for line in ensure(call, args.credentials, accounts, args.model):
            print(line)
    except RefusedError as error:
        print(f"zitadel_role_accounts refused: {error}", file=sys.stderr)
        return 2
    print(f"SEED_ROLE_EMAILS={seed_role_emails(accounts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
