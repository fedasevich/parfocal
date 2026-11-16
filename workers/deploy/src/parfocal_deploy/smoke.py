import argparse
import re
import sys
import urllib.error
from collections.abc import Mapping, Sequence

from parfocal_deploy.tools import Fetch, fetch

PRODUCTION_ORIGIN = "https://app.parfocal.eu"
ISOLATION_HEADERS = {
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless",
}
TRANSPORT_SECURITY = "strict-transport-security"
JSON = "application/json"
SECURITY_HEADERS = {
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
}
PERMISSIONS = ("hid=(self)", "gamepad=(self)", "camera=()", "microphone=()")
CSP = "content-security-policy"
CSP_PARTS = (
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
)
NONCE = re.compile(r"script-src 'nonce-([A-Za-z0-9+/=]+)'")


class SmokeCheckError(Exception):
    pass


def wrong_isolation(headers: Mapping[str, str]) -> list[str]:
    return [name for name, value in ISOLATION_HEADERS.items() if headers.get(name) != value]


def health_problems(origin: str, get: Fetch) -> list[str]:
    url = f"{origin}/api/health"
    status, headers = get(url)
    problems = [f"{url} answered {status}"] if status != 200 else []
    if not headers.get("content-type", "").startswith(JSON):
        problems.append(f"{url} is not {JSON}")
    problems += [f"{url} has a wrong {name}" for name in wrong_isolation(headers)]
    return problems


def page_problems(origin: str, get: Fetch) -> list[str]:
    url = f"{origin}/"
    status, headers = get(url)
    problems = [f"{url} answered {status}"] if status != 200 else []
    if "max-age=" not in headers.get(TRANSPORT_SECURITY, ""):
        problems.append(f"{url} has no {TRANSPORT_SECURITY}")
    problems += [f"{url} has a wrong {name}" for name in wrong_isolation(headers)]
    return problems


def nonce_of(policy: str) -> str | None:
    found = NONCE.search(policy)
    return found.group(1) if found else None


def security_header_problems(origin: str, get: Fetch) -> list[str]:
    url = f"{origin}/"
    _, first = get(url)
    _, second = get(url)
    problems = [
        f"{url} has a wrong {name}"
        for name, value in SECURITY_HEADERS.items()
        if first.get(name) != value
    ]
    permissions = first.get("permissions-policy", "")
    problems += [
        f"{url} permissions-policy lacks {feature}"
        for feature in PERMISSIONS
        if feature not in permissions
    ]
    policy = first.get(CSP, "")
    problems += [f"{url} {CSP} lacks {part}" for part in CSP_PARTS if part not in policy]
    nonce = nonce_of(policy)
    if nonce is None:
        problems.append(f"{url} {CSP} has no script nonce")
    elif nonce == nonce_of(second.get(CSP, "")):
        problems.append(f"{url} {CSP} repeats its nonce across requests")
    return problems


def smoke_check(origin: str, get: Fetch) -> None:
    origin = origin.rstrip("/")
    if not origin.startswith("https://"):
        raise SmokeCheckError(f"{origin} is not served over TLS")
    try:
        problems = (
            health_problems(origin, get)
            + page_problems(origin, get)
            + security_header_problems(origin, get)
        )
    except urllib.error.URLError as error:
        raise SmokeCheckError(f"{origin} could not be reached over TLS: {error.reason}") from error
    if problems:
        raise SmokeCheckError("; ".join(problems))


def main(argv: Sequence[str] | None = None, get: Fetch = fetch) -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.smoke")
    parser.add_argument("--origin", default=PRODUCTION_ORIGIN)
    arguments = parser.parse_args(argv)
    try:
        smoke_check(arguments.origin, get)
    except SmokeCheckError as error:
        sys.exit(f"smoke check failed: {error}")
    sys.stdout.write(
        f"{arguments.origin} serves the app and /api/health over TLS, isolated, "
        "with the security headers\n"
    )


if __name__ == "__main__":
    main()
