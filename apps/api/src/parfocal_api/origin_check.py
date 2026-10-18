from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Receive, Scope, Send

from parfocal_api.auth import SESSION_COOKIE
from parfocal_api.problems import problem_response

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def from_elsewhere(headers: dict[bytes, bytes], origin: str) -> bool:
    if b"authorization" in headers:
        return False
    if SESSION_COOKIE not in cookie_parser(headers.get(b"cookie", b"").decode("latin-1")):
        return False
    sent = headers.get(b"origin")
    if sent is not None:
        return sent.decode("latin-1").lower() != origin.lower()
    return headers.get(b"sec-fetch-site") != b"same-origin"


class OriginCheck:
    def __init__(self, app: ASGIApp, origin: str) -> None:
        self.app = app
        self.origin = origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            headers = dict(scope.get("headers", []))
            if from_elsewhere(headers, self.origin):
                response = problem_response(
                    403, "cross-origin-write", "Changes must come from the Parfocal app"
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
