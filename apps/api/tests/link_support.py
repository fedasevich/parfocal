import threading
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class Served:
    status: int = 200
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict[str, str])
    head_length: int | None = None


class Site:
    def __init__(self) -> None:
        self.routes: dict[str, Served] = {}
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def answer(self, method: str) -> None:
                site.requests.append((method, self.path, dict(self.headers)))
                served = site.routes.get(self.path, Served(404))
                self.send_response(served.status)
                for name, value in served.headers.items():
                    self.send_header(name, value)
                length = served.head_length if method == "HEAD" else None
                self.send_header("content-length", str(length or len(served.body)))
                self.end_headers()
                if method == "GET":
                    self.wfile.write(served.body)

            def do_GET(self) -> None:
                self.answer("GET")

            def do_HEAD(self) -> None:
                self.answer("HEAD")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]

    @property
    def origin(self) -> str:
        return f"127.0.0.1:{self.port}"

    def url(self, path: str) -> str:
        return f"http://{self.origin}{path}"

    def index(self, path: str, names: list[str]) -> None:
        links = "".join(f'<a href="{name}">{name}</a>' for name in names)
        self.routes[path] = Served(
            body=f"<html><body>{links}</body></html>".encode(),
            headers={"content-type": "text/html; charset=utf-8"},
        )

    def file(self, path: str, body: bytes, **extra: Any) -> None:
        self.routes[path] = Served(
            body=body, headers={"content-type": "application/octet-stream"}, **extra
        )


@contextmanager
def serving() -> Generator[Site]:
    served = Site()
    thread = threading.Thread(target=served.server.serve_forever, daemon=True)
    thread.start()
    try:
        yield served
    finally:
        served.server.shutdown()
        served.server.server_close()
