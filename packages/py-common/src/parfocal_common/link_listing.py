import re
from dataclasses import dataclass, replace
from html import unescape
from pathlib import PurePosixPath
from urllib.parse import parse_qsl, quote, unquote, urlencode
from xml.etree import ElementTree

import httpx2

from parfocal_common.link_fetch import (
    LinkPolicy,
    LinkRefusedError,
    Opened,
    declared_size,
    open_link,
    read_capped,
)

LISTING_MAX_BYTES = 4 * 1024 * 1024
MAX_LISTED = 500
MAX_PROBED = 200
LISTING_TYPES = ("text/html", "application/xml", "text/xml")
AZURE_LISTING_QUERY = frozenset({"restype", "comp", "prefix", "marker", "maxresults"})
HREF = re.compile(r"""href\s*=\s*["']([^"'#]+)["']""", re.IGNORECASE)


@dataclass(frozen=True)
class LinkedFile:
    name: str
    url: str
    size: int | None


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    return next((item for item in element if local(item.tag) == name), None)


def text_of(element: ElementTree.Element | None, name: str) -> str | None:
    found = child(element, name) if element is not None else None
    return found.text if found is not None else None


def size_of(value: str | None) -> int | None:
    return int(value) if value is not None and value.isdigit() else None


def base_path(url: httpx2.URL) -> str:
    return url.copy_with(query=None, fragment=None).raw_path.decode("ascii").split("?")[0]


def object_url(url: httpx2.URL, key: str, query: str = "") -> str:
    folder = base_path(url).rstrip("/")
    path = f"{folder}/{quote(key)}"
    return str(url.copy_with(raw_path=(path + (f"?{query}" if query else "")).encode("ascii")))


def s3_files(url: httpx2.URL, root: ElementTree.Element) -> list[LinkedFile]:
    files: list[LinkedFile] = []
    for entry in root:
        key = text_of(entry, "Key") if local(entry.tag) == "Contents" else None
        if key and not key.endswith("/"):
            files.append(
                LinkedFile(
                    PurePosixPath(key).name, object_url(url, key), size_of(text_of(entry, "Size"))
                )
            )
    return files


def azure_files(url: httpx2.URL, root: ElementTree.Element) -> list[LinkedFile]:
    kept = [
        (name, value)
        for name, value in parse_qsl(url.query.decode("ascii"), keep_blank_values=True)
        if name not in AZURE_LISTING_QUERY
    ]
    query = urlencode(kept)
    blobs = child(root, "Blobs")
    entries: list[ElementTree.Element] = list(blobs) if blobs is not None else []
    files: list[LinkedFile] = []
    for blob in entries:
        name = text_of(blob, "Name") if local(blob.tag) == "Blob" else None
        if name and not name.endswith("/"):
            size = size_of(text_of(child(blob, "Properties"), "Content-Length"))
            files.append(LinkedFile(PurePosixPath(name).name, object_url(url, name, query), size))
    return files


def xml_files(url: httpx2.URL, body: bytes) -> list[LinkedFile]:
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return []
    match local(root.tag):
        case "ListBucketResult":
            return s3_files(url, root)
        case "EnumerationResults":
            return azure_files(url, root)
        case _:
            return []


def html_links(url: httpx2.URL, body: bytes) -> list[str]:
    seen: dict[str, None] = {}
    for href in HREF.findall(body.decode("utf-8", errors="replace")):
        joined = url.join(unescape(href.strip()))
        if joined.host != url.host or joined.port != url.port or joined.scheme != url.scheme:
            continue
        path = joined.path
        if path.endswith("/") or not path.startswith(url.path.rsplit("/", 1)[0]):
            continue
        seen[str(joined.copy_with(fragment=None))] = None
    return list(seen)


def name_of(url: httpx2.URL) -> str:
    return unquote(PurePosixPath(url.path).name) or "download"


async def probed(client: httpx2.AsyncClient, address: str, policy: LinkPolicy) -> LinkedFile:
    url = httpx2.URL(address)
    try:
        async with open_link(client, address, policy, "HEAD") as opened:
            return LinkedFile(name_of(url), address, declared_size(opened.response))
    except LinkRefusedError:
        return LinkedFile(name_of(url), address, None)


def listing_kind(opened: Opened) -> str | None:
    content_type = opened.response.headers.get("content-type", "").split(";")[0].strip().lower()
    return content_type if content_type in LISTING_TYPES else None


async def list_link(
    client: httpx2.AsyncClient, address: str, policy: LinkPolicy
) -> list[LinkedFile]:
    opening = replace(policy, max_bytes=None)
    reading = replace(policy, max_bytes=LISTING_MAX_BYTES)
    async with open_link(client, address, opening) as opened:
        kind = listing_kind(opened)
        if kind is None:
            return [
                LinkedFile(name_of(opened.url), str(opened.url), declared_size(opened.response))
            ]
        body = await read_capped(opened.response, reading)
        url = opened.url
    if kind != "text/html":
        return xml_files(url, body)[:MAX_LISTED]
    links = html_links(url, body)[:MAX_PROBED]
    return [await probed(client, link, opening) for link in links]
