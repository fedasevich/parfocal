import hashlib
import hmac
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit
from xml.etree import ElementTree

import httpx2

ALGORITHM = "AWS4-HMAC-SHA256"
SERVICE = "s3"
UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
MAX_PRESIGN_SECONDS = 7 * 24 * 3600
LIST_PAGE_LIMIT = 1000


@dataclass(frozen=True)
class StorageLocation:
    endpoint: str
    region: str
    bucket: str
    access_key_id: str
    secret_access_key: str


@dataclass(frozen=True)
class StoredPart:
    part_number: int
    size: int
    etag: str


@dataclass(frozen=True)
class CompletedObject:
    etag: str


class StorageError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code


class NoSuchUploadError(StorageError):
    pass


def uri_encode(value: str, *, keep_slash: bool = False) -> str:
    return quote(value, safe="-_.~/" if keep_slash else "-_.~")


def canonical_query(query: Mapping[str, str]) -> str:
    pairs = sorted((uri_encode(key), uri_encode(value)) for key, value in query.items())
    return "&".join(f"{key}={value}" for key, value in pairs)


def signing_key(secret: str, date: str, region: str) -> bytes:
    key = f"AWS4{secret}".encode()
    for part in (date, region, SERVICE, "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return key


@dataclass(frozen=True)
class Signature:
    credential: str
    signed_headers: str
    value: str


def signature(
    location: StorageLocation,
    method: str,
    path: str,
    query: Mapping[str, str],
    headers: Mapping[str, str],
    payload_hash: str,
    now: datetime,
) -> Signature:
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date = amz_date[:8]
    scope = f"{date}/{location.region}/{SERVICE}/aws4_request"
    lowered = {name.lower(): " ".join(value.split()) for name, value in headers.items()}
    names = sorted(lowered)
    canonical_headers = "".join(f"{name}:{lowered[name]}\n" for name in names)
    signed_headers = ";".join(names)
    canonical_request = "\n".join(
        [
            method,
            uri_encode(path, keep_slash=True),
            canonical_query(query),
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    string_to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    value = hmac.new(
        signing_key(location.secret_access_key, date, location.region),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    return Signature(f"{location.access_key_id}/{scope}", signed_headers, value)


def host_of(endpoint: str) -> str:
    return urlsplit(endpoint).netloc


def object_path(location: StorageLocation, key: str) -> str:
    return f"/{location.bucket}/{key}" if key else f"/{location.bucket}"


def presign(
    location: StorageLocation,
    method: str,
    key: str,
    query: Mapping[str, str],
    expires_seconds: int,
    now: datetime,
) -> str:
    if not 1 <= expires_seconds <= MAX_PRESIGN_SECONDS:
        raise ValueError("A presigned URL lives from 1 second to 7 days")
    path = object_path(location, key)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    scope = f"{amz_date[:8]}/{location.region}/{SERVICE}/aws4_request"
    signed_query = {
        **query,
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{location.access_key_id}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires_seconds),
        "X-Amz-SignedHeaders": "host",
    }
    signed = signature(
        location,
        method,
        path,
        signed_query,
        {"host": host_of(location.endpoint)},
        UNSIGNED_PAYLOAD,
        now,
    )
    final_query = canonical_query({**signed_query, "X-Amz-Signature": signed.value})
    return f"{location.endpoint.rstrip('/')}{uri_encode(path, keep_slash=True)}?{final_query}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element: ElementTree.Element, name: str) -> str | None:
    for child in element:
        if local_name(child.tag) == name:
            return child.text or ""
    return None


def children(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in element if local_name(child.tag) == name]


def parse(body: bytes) -> ElementTree.Element:
    return ElementTree.fromstring(body)


def unquote_etag(etag: str) -> str:
    return etag.strip().strip('"')


def error_of(status: int, body: bytes) -> StorageError:
    code = "unknown"
    if body:
        try:
            root = parse(body)
        except ElementTree.ParseError:
            root = None
        if root is not None and local_name(root.tag) == "Error":
            code = child_text(root, "Code") or code
    if code == "NoSuchUpload":
        return NoSuchUploadError(status, code)
    return StorageError(status, code)


def completion_xml(parts: Sequence[StoredPart]) -> bytes:
    root = ElementTree.Element("CompleteMultipartUpload")
    for part in parts:
        element = ElementTree.SubElement(root, "Part")
        ElementTree.SubElement(element, "PartNumber").text = str(part.part_number)
        ElementTree.SubElement(element, "ETag").text = f'"{part.etag}"'
    return ElementTree.tostring(root, encoding="utf-8")


class ObjectStore:
    def __init__(self, location: StorageLocation, http: httpx2.AsyncClient) -> None:
        self.location = location
        self.http = http

    async def send(
        self,
        method: str,
        key: str,
        query: Mapping[str, str] | None = None,
        body: bytes = b"",
    ) -> httpx2.Response:
        now = datetime.now(UTC)
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = {
            "host": host_of(self.location.endpoint),
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": now.strftime("%Y%m%dT%H%M%SZ"),
        }
        path = object_path(self.location, key)
        signed = signature(self.location, method, path, query or {}, headers, payload_hash, now)
        authorization = (
            f"{ALGORITHM} Credential={signed.credential}, "
            f"SignedHeaders={signed.signed_headers}, Signature={signed.value}"
        )
        url = f"{self.location.endpoint.rstrip('/')}{uri_encode(path, keep_slash=True)}"
        query_string = canonical_query(query or {})
        response = await self.http.request(
            method,
            f"{url}?{query_string}" if query_string else url,
            headers={
                "x-amz-content-sha256": payload_hash,
                "x-amz-date": headers["x-amz-date"],
                "authorization": authorization,
            },
            content=body or None,
        )
        if response.status_code >= 300:
            raise error_of(response.status_code, response.content)
        return response

    async def create_bucket(self) -> None:
        try:
            await self.send("PUT", "")
        except StorageError as error:
            if error.code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                raise

    async def create_multipart_upload(self, key: str) -> str:
        response = await self.send("POST", key, {"uploads": ""})
        upload_id = child_text(parse(response.content), "UploadId")
        if not upload_id:
            raise StorageError(response.status_code, "missing-upload-id")
        return upload_id

    async def list_parts(
        self, key: str, upload_id: str, page_size: int = LIST_PAGE_LIMIT
    ) -> list[StoredPart]:
        parts: list[StoredPart] = []
        marker = "0"
        while True:
            response = await self.send(
                "GET",
                key,
                {
                    "uploadId": upload_id,
                    "max-parts": str(min(page_size, LIST_PAGE_LIMIT)),
                    "part-number-marker": marker,
                },
            )
            root = parse(response.content)
            for element in children(root, "Part"):
                parts.append(
                    StoredPart(
                        part_number=int(child_text(element, "PartNumber") or 0),
                        size=int(child_text(element, "Size") or 0),
                        etag=unquote_etag(child_text(element, "ETag") or ""),
                    )
                )
            if (child_text(root, "IsTruncated") or "false").lower() != "true":
                return parts
            following = child_text(root, "NextPartNumberMarker")
            if not following or following == marker:
                return parts
            marker = following

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: Sequence[StoredPart]
    ) -> CompletedObject:
        response = await self.send("POST", key, {"uploadId": upload_id}, completion_xml(parts))
        root = parse(response.content)
        if local_name(root.tag) == "Error":
            raise error_of(response.status_code, response.content)
        return CompletedObject(etag=unquote_etag(child_text(root, "ETag") or ""))

    async def abort_multipart_upload(self, key: str, upload_id: str) -> bool:
        try:
            await self.send("DELETE", key, {"uploadId": upload_id})
        except NoSuchUploadError:
            return False
        return True

    def presign_part(self, key: str, upload_id: str, part_number: int, expires_seconds: int) -> str:
        return presign(
            self.location,
            "PUT",
            key,
            {"partNumber": str(part_number), "uploadId": upload_id},
            expires_seconds,
            datetime.now(UTC),
        )
