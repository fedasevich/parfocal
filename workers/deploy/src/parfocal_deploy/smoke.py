import argparse
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


def smoke_check(origin: str, get: Fetch) -> None:
    origin = origin.rstrip("/")
    if not origin.startswith("https://"):
        raise SmokeCheckError(f"{origin} is not served over TLS")
    try:
        problems = health_problems(origin, get) + page_problems(origin, get)
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
    sys.stdout.write(f"{arguments.origin} serves the app and /api/health over TLS, isolated\n")


if __name__ == "__main__":
    main()
