import asyncio
import ipaddress
import socket
from collections.abc import AsyncGenerator, AsyncIterator, Collection
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import StrEnum

import httpx2

MAX_REDIRECTS = 5
REDIRECTS = frozenset({301, 302, 303, 307, 308})
USER_AGENT = "Parfocal link import"
DEFAULT_PORTS = {"http": 80, "https": 443}

type Address = ipaddress.IPv4Address | ipaddress.IPv6Address


class LinkRefusal(StrEnum):
    SCHEME = "link-scheme"
    CREDENTIALS = "link-credentials"
    ADDRESS = "link-address"
    REDIRECTS = "link-redirects"
    TOO_LARGE = "link-too-large"
    SIZE_UNKNOWN = "link-size-unknown"
    UNREACHABLE = "link-unreachable"
    STATUS = "link-status"
    TIMEOUT = "link-timeout"


LINK_FAILURES = {
    LinkRefusal.SCHEME: "Only HTTPS links can be imported.",
    LinkRefusal.CREDENTIALS: (
        "The address holds a user name or password, which Parfocal never sends or stores."
    ),
    LinkRefusal.ADDRESS: (
        "The link points at a private or internal address, which Parfocal never fetches."
    ),
    LinkRefusal.REDIRECTS: "The link redirects too many times.",
    LinkRefusal.TOO_LARGE: "The file at the link is larger than an upload may be.",
    LinkRefusal.SIZE_UNKNOWN: "The server behind the link does not say how large the file is.",
    LinkRefusal.UNREACHABLE: "The server behind the link could not be reached.",
    LinkRefusal.STATUS: "The server behind the link refused to give the file.",
    LinkRefusal.TIMEOUT: "The server behind the link took too long to answer.",
}


class LinkRefusedError(Exception):
    def __init__(self, code: LinkRefusal) -> None:
        super().__init__(code.value)
        self.code = code


@dataclass(frozen=True)
class LinkPolicy:
    trusted_origins: frozenset[str] = field(default_factory=frozenset[str])
    max_bytes: int | None = None

    def trusts(self, url: httpx2.URL) -> bool:
        return origin_of(url) in self.trusted_origins


def policy_of(trusted_origins: Collection[str], max_bytes: int | None = None) -> LinkPolicy:
    return LinkPolicy(frozenset(origin.lower() for origin in trusted_origins), max_bytes)


def port_of(url: httpx2.URL) -> int:
    return url.port or DEFAULT_PORTS.get(url.scheme, 0)


def origin_of(url: httpx2.URL) -> str:
    return f"{url.host.lower()}:{port_of(url)}"


def public(address: Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return public(address.ipv4_mapped)
    return address.is_global and not address.is_multicast


async def addresses_of(host: str, port: int) -> list[Address]:
    try:
        found = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise LinkRefusedError(LinkRefusal.UNREACHABLE) from error
    return [ipaddress.ip_address(str(entry[4][0]).split("%", 1)[0]) for entry in found]


@dataclass(frozen=True)
class Target:
    url: httpx2.URL
    headers: dict[str, str]
    extensions: dict[str, str]


def host_header(url: httpx2.URL) -> str:
    host = f"[{url.host}]" if ":" in url.host else url.host
    return host if url.port is None else f"{host}:{url.port}"


async def target_of(url: httpx2.URL, policy: LinkPolicy) -> Target:
    if url.userinfo:
        raise LinkRefusedError(LinkRefusal.CREDENTIALS)
    trusted = policy.trusts(url)
    if url.scheme != "https" and not (url.scheme == "http" and trusted):
        raise LinkRefusedError(LinkRefusal.SCHEME)
    if not url.host:
        raise LinkRefusedError(LinkRefusal.UNREACHABLE)
    if trusted:
        return Target(url, {}, {})
    addresses = await addresses_of(url.host, port_of(url))
    if not addresses or not all(public(address) for address in addresses):
        raise LinkRefusedError(LinkRefusal.ADDRESS)
    pinned = url.copy_with(host=str(addresses[0]))
    return Target(pinned, {"host": host_header(url)}, {"sni_hostname": url.host})


def link_client(timeout_seconds: float) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(
        timeout=httpx2.Timeout(timeout_seconds),
        follow_redirects=False,
        trust_env=False,
        headers={"user-agent": USER_AGENT},
    )


def declared_size(response: httpx2.Response) -> int | None:
    value = response.headers.get("content-length")
    if value is None or not value.isdigit():
        return None
    return int(value)


def check_size(response: httpx2.Response, policy: LinkPolicy) -> None:
    size = declared_size(response)
    if policy.max_bytes is not None and size is not None and size > policy.max_bytes:
        raise LinkRefusedError(LinkRefusal.TOO_LARGE)


@dataclass(frozen=True)
class Opened:
    url: httpx2.URL
    response: httpx2.Response


@asynccontextmanager
async def open_link(
    client: httpx2.AsyncClient, address: str, policy: LinkPolicy, method: str = "GET"
) -> AsyncGenerator[Opened]:
    try:
        url = httpx2.URL(address)
    except httpx2.InvalidURL as error:
        raise LinkRefusedError(LinkRefusal.SCHEME) from error
    for _ in range(MAX_REDIRECTS + 1):
        target = await target_of(url, policy)
        request = client.build_request(
            method, target.url, headers=target.headers, extensions=target.extensions
        )
        try:
            response = await client.send(request, stream=True)
        except httpx2.TimeoutException as error:
            raise LinkRefusedError(LinkRefusal.TIMEOUT) from error
        except httpx2.HTTPError as error:
            raise LinkRefusedError(LinkRefusal.UNREACHABLE) from error
        if response.status_code in REDIRECTS and "location" in response.headers:
            await response.aclose()
            url = url.join(response.headers["location"])
            continue
        try:
            if response.status_code >= 300:
                raise LinkRefusedError(LinkRefusal.STATUS)
            check_size(response, policy)
            yield Opened(url, response)
        finally:
            await response.aclose()
        return
    raise LinkRefusedError(LinkRefusal.REDIRECTS)


async def chunks_of(
    response: httpx2.Response, policy: LinkPolicy, chunk_bytes: int
) -> AsyncIterator[bytes]:
    total = 0
    try:
        async for chunk in response.aiter_bytes(chunk_bytes):
            total += len(chunk)
            if policy.max_bytes is not None and total > policy.max_bytes:
                raise LinkRefusedError(LinkRefusal.TOO_LARGE)
            yield chunk
    except httpx2.TimeoutException as error:
        raise LinkRefusedError(LinkRefusal.TIMEOUT) from error
    except httpx2.HTTPError as error:
        raise LinkRefusedError(LinkRefusal.UNREACHABLE) from error


async def read_capped(response: httpx2.Response, policy: LinkPolicy) -> bytes:
    return b"".join([chunk async for chunk in chunks_of(response, policy, 64 * 1024)])
