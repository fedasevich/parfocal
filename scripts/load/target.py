import os
from urllib.parse import urlsplit

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
ALLOW_ENV = "PARFOCAL_LOAD_ALLOW_HOST"


class TargetRefusedError(ValueError):
    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"Refusing load target {url!r}: {reason}")


def is_staging(host: str) -> bool:
    return any("staging" in label for label in host.split("."))


def checked_target(url: str | None, allowed: str | None = None) -> str:
    if not url:
        raise TargetRefusedError("", "pass --host or set the target URL explicitly")
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme not in {"http", "https", "ws", "wss"} or not host:
        raise TargetRefusedError(url, "it is not an http, https, ws or wss URL with a host")
    if host in LOCAL_HOSTS or is_staging(host):
        return url.rstrip("/")
    if allowed and host == allowed.lower():
        return url.rstrip("/")
    raise TargetRefusedError(
        url, f"only localhost and staging hosts are allowed, or the exact host in {ALLOW_ENV}"
    )


def target_from_env(name: str, fallback: str | None) -> str:
    return checked_target(os.environ.get(name) or fallback, os.environ.get(ALLOW_ENV))
