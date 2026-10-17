import logging
import re
import time
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from parfocal_common.structured_logging import log_context

REQUEST_ID_HEADER = b"x-request-id"
VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

logger = logging.getLogger("parfocal.api.requests")


def incoming_request_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == REQUEST_ID_HEADER:
            text = value.decode("latin-1")
            return text if VALID_REQUEST_ID.match(text) else None
    return None


def route_of(scope: Scope) -> str:
    route: Any = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "unmatched"


class RequestLogging:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500
        with log_context(incoming_request_id(scope)) as context:
            request_id = context.request_id.encode("latin-1")

            async def send_with_id(message: Message) -> None:
                nonlocal status
                if message["type"] == "http.response.start":
                    status = message["status"]
                    headers = [
                        (name, value)
                        for name, value in message.get("headers", [])
                        if name != REQUEST_ID_HEADER
                    ]
                    message = {**message, "headers": [*headers, (REQUEST_ID_HEADER, request_id)]}
                await send(message)

            try:
                await self.app(scope, receive, send_with_id)
            finally:
                logger.info(
                    "request finished",
                    extra={
                        "method": scope.get("method"),
                        "route": route_of(scope),
                        "status_code": status,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    },
                )
