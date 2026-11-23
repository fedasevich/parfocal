from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_CACHE_CONTROL = b"private, no-store"


class PrivateByDefault:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def marked(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not any(name.lower() == b"cache-control" for name, _ in headers):
                    headers.append((b"cache-control", DEFAULT_CACHE_CONTROL))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, marked)
