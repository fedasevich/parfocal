import os
from urllib.parse import urlsplit

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
PRODUCTION_DOMAIN = "parfocal.eu"
MODAL_DOMAIN = "modal.run"
ALLOW_ENV = "PARFOCAL_LOAD_ALLOW_HOST"
LIFT_ENV = "PARFOCAL_LOAD_LIFT_LIMITS"
CLOUD_USERS = 2
CLOUD_SECONDS = 60


class TargetRefusedError(ValueError):
    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"Refusing load target {url!r}: {reason}")


class LoadRefusedError(ValueError):
    pass


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def within(host: str, domain: str) -> bool:
    return host == domain or host.endswith(f".{domain}")


def is_cloud(url: str) -> bool:
    return host_of(url) not in LOCAL_HOSTS


def checked_target(url: str | None, allowed: str | None = None) -> str:
    if not url:
        raise TargetRefusedError("", "pass --host or set the target URL explicitly")
    parts = urlsplit(url)
    host = host_of(url)
    if parts.scheme not in {"http", "https", "ws", "wss"} or not host:
        raise TargetRefusedError(url, "it is not an http, https, ws or wss URL with a host")
    if host in LOCAL_HOSTS or within(host, PRODUCTION_DOMAIN) or within(host, MODAL_DOMAIN):
        return url.rstrip("/")
    if allowed and host == allowed.lower():
        return url.rstrip("/")
    raise TargetRefusedError(
        url,
        f"only localhost, {PRODUCTION_DOMAIN} and {MODAL_DOMAIN} hosts are allowed, "
        f"or the exact host in {ALLOW_ENV}",
    )


def target_from_env(name: str, fallback: str | None) -> str:
    return checked_target(os.environ.get(name) or fallback, os.environ.get(ALLOW_ENV))


def check_cloud_load(users: int, seconds: int | None, headless: bool, lifted: bool) -> None:
    if not headless:
        raise LoadRefusedError("A cloud target runs only with --headless")
    if not seconds:
        raise LoadRefusedError("A cloud target runs only with a set --run-time")
    if lifted:
        return
    if users > CLOUD_USERS:
        raise LoadRefusedError(
            f"A cloud target allows at most {CLOUD_USERS} users unless {LIFT_ENV} is set"
        )
    if seconds > CLOUD_SECONDS:
        raise LoadRefusedError(
            f"A cloud target allows at most {CLOUD_SECONDS} seconds unless {LIFT_ENV} is set"
        )
