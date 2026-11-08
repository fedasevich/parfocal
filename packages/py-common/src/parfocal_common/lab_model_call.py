import base64
import struct
import time
import zlib
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Annotated, Any, Literal

import httpx2
from pydantic import BaseModel, Field, JsonValue, StringConstraints, ValidationError

from parfocal_common.link_fetch import (
    LinkPolicy,
    LinkRefusal,
    LinkRefusedError,
    link_client,
    read_capped,
    target_of,
)
from parfocal_common.structured_logging import register_sensitive

MAX_ANSWER_BYTES = 8 * 1024 * 1024
MAX_NAME = 80
SAMPLE_ORIGIN = (18432, 9216)
SAMPLE_SLIDE = "the Parfocal sample tile"
USER_AGENT = "Parfocal model test"


class SignIn(StrEnum):
    NONE = "none"
    TOKEN = "token"
    HEADER = "header"


class CallRefusal(StrEnum):
    ADDRESS = "address"
    SCHEME = "scheme"
    CREDENTIALS = "credentials"
    REDIRECT = "redirect"
    UNREACHABLE = "unreachable"
    TIMEOUT = "timeout"
    STATUS = "status"
    TOO_LARGE = "too-large"


CALL_FAILURES = {
    CallRefusal.ADDRESS: (
        "The address points at a private or internal server, which Parfocal never calls."
    ),
    CallRefusal.SCHEME: "Only HTTPS addresses can be connected.",
    CallRefusal.CREDENTIALS: (
        "The address holds a user name or password. Use the sign-in fields for credentials."
    ),
    CallRefusal.REDIRECT: "The server answered with a redirect, which Parfocal does not follow.",
    CallRefusal.UNREACHABLE: "The server could not be reached.",
    CallRefusal.TIMEOUT: "The server took too long to answer.",
    CallRefusal.STATUS: "The server refused the sample tile.",
    CallRefusal.TOO_LARGE: "The server's answer is larger than Parfocal reads.",
}

LINK_TO_CALL = {
    LinkRefusal.ADDRESS: CallRefusal.ADDRESS,
    LinkRefusal.SCHEME: CallRefusal.SCHEME,
    LinkRefusal.CREDENTIALS: CallRefusal.CREDENTIALS,
    LinkRefusal.UNREACHABLE: CallRefusal.UNREACHABLE,
    LinkRefusal.TIMEOUT: CallRefusal.TIMEOUT,
    LinkRefusal.TOO_LARGE: CallRefusal.TOO_LARGE,
}


class CallRefusedError(Exception):
    def __init__(self, code: CallRefusal) -> None:
        super().__init__(code.value)
        self.code = code


@dataclass(frozen=True)
class Endpoint:
    address: str
    sign_in: SignIn
    secret: str | None
    header_name: str | None = None

    def auth_headers(self) -> dict[str, str]:
        if self.sign_in is SignIn.NONE or not self.secret:
            return {}
        register_sensitive(self.secret)
        if self.sign_in is SignIn.TOKEN:
            return {"authorization": f"Bearer {self.secret}"}
        return {self.header_name or "x-api-key": self.secret}


@dataclass(frozen=True)
class SentObject:
    kind: str
    name: str
    ring: list[tuple[float, float]]


@dataclass(frozen=True)
class Answer:
    follows_contract: bool
    answered_ms: int
    server_software: str | None
    model_name: str | None = None
    model_version: str | None = None
    objects: list[SentObject] = field(default_factory=list[SentObject])
    missing_geometry: int = 0


def png_chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))


def sample_tile(size: int) -> bytes:
    stained, plain = bytes((196, 120, 170)), bytes((238, 206, 226))
    bands = [
        b"\0" + b"".join(stained if (x // 32 + band) % 3 == 0 else plain for x in range(size))
        for band in range(3)
    ]
    rows = b"".join(bands[(y // 32) % 3] for y in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(rows, 6))
        + png_chunk(b"IEND", b"")
    )


def request_body(tile_size: int, magnification: int) -> dict[str, Any]:
    encoded = base64.b64encode(sample_tile(tile_size)).decode()
    return {
        "tile": f"data:image/png;base64,{encoded}",
        "size": tile_size,
        "magnification": magnification,
        "origin": list(SAMPLE_ORIGIN),
    }


class Polygon(BaseModel):
    type: Literal["Polygon"]
    coordinates: list[list[tuple[float, float]]] = Field(min_length=1)


class AnsweredObject(BaseModel):
    kind: Literal["cell", "region"]
    class_: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] = Field(
        alias="class"
    )
    geometry: Polygon


class AnswerBody(BaseModel):
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    objects: list[JsonValue]


class AnswerHead(BaseModel):
    model: JsonValue = None
    version: JsonValue = None


def short_text(value: JsonValue | str | None) -> str | None:
    if not isinstance(value, str | int | float) or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text[:MAX_NAME] if text else None


def sent_object(item: JsonValue) -> SentObject | None:
    try:
        parsed = AnsweredObject.model_validate(item)
    except ValidationError:
        return None
    ring = parsed.geometry.coordinates[0]
    return SentObject(parsed.kind, parsed.class_[:MAX_NAME], ring) if len(ring) >= 3 else None


def read_answer(body: bytes, answered_ms: int, server: str | None) -> Answer:
    try:
        parsed = AnswerBody.model_validate_json(body)
    except ValidationError:
        try:
            head = AnswerHead.model_validate_json(body)
        except ValidationError:
            return Answer(False, answered_ms, server)
        return Answer(False, answered_ms, server, short_text(head.model), short_text(head.version))
    found = [sent_object(item) for item in parsed.objects]
    sent = [item for item in found if item is not None]
    missing = len(found) - len(sent)
    return Answer(
        missing == 0 and bool(sent),
        answered_ms,
        server,
        parsed.model[:MAX_NAME],
        parsed.version[:MAX_NAME],
        sent,
        missing,
    )


async def call_endpoint(
    endpoint: Endpoint,
    policy: LinkPolicy,
    timeout_seconds: float,
    tile_size: int,
    magnification: int,
) -> Answer:
    try:
        url = httpx2.URL(endpoint.address)
    except httpx2.InvalidURL as error:
        raise CallRefusedError(CallRefusal.SCHEME) from error
    try:
        target = await target_of(url, policy)
    except LinkRefusedError as error:
        raise CallRefusedError(LINK_TO_CALL.get(error.code, CallRefusal.UNREACHABLE)) from error
    started = time.monotonic()
    async with link_client(timeout_seconds) as client:
        client.headers["user-agent"] = USER_AGENT
        request = client.build_request(
            "POST",
            target.url,
            headers={**target.headers, **endpoint.auth_headers()},
            json=request_body(tile_size, magnification),
            extensions=target.extensions,
        )
        try:
            response = await client.send(request, stream=True)
        except httpx2.TimeoutException as error:
            raise CallRefusedError(CallRefusal.TIMEOUT) from error
        except httpx2.HTTPError as error:
            raise CallRefusedError(CallRefusal.UNREACHABLE) from error
        try:
            if 300 <= response.status_code < 400:
                raise CallRefusedError(CallRefusal.REDIRECT)
            if response.status_code >= 400:
                raise CallRefusedError(CallRefusal.STATUS)
            try:
                body = await read_capped(response, LinkPolicy(max_bytes=MAX_ANSWER_BYTES))
            except LinkRefusedError as error:
                raise CallRefusedError(
                    LINK_TO_CALL.get(error.code, CallRefusal.UNREACHABLE)
                ) from error
        finally:
            await response.aclose()
    answered_ms = round((time.monotonic() - started) * 1000)
    return read_answer(body, answered_ms, short_text(response.headers.get("server")))
