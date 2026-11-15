import importlib
import json
import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, TextIO

TOKEN_VARIABLE = "PARFOCAL_JOB_TOKEN"
BLOCKED_EVENTS = frozenset(
    {
        "socket.bind",
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.sendmsg",
        "socket.sendto",
        "subprocess.Popen",
        "os.exec",
        "os.fork",
        "os.forkpty",
        "os.posix_spawn",
        "os.spawn",
        "os.system",
        "pty.spawn",
    }
)


class SandboxRefusedError(PermissionError):
    pass


def guard(event: str, _arguments: tuple[Any, ...]) -> None:
    if event in BLOCKED_EVENTS:
        raise SandboxRefusedError(f"{event} is not allowed while parsing an uploaded file")


class ScopedStorage:
    def __init__(self, token: str, replies: TextIO, requests: TextIO) -> None:
        self.token = token
        self.replies = replies
        self.requests = requests

    def fetch(self, key: str) -> Path:
        self.requests.write(json.dumps({"fetch": key, "token": self.token}) + "\n")
        self.requests.flush()
        reply = json.loads(self.replies.readline() or "{}")
        if "path" not in reply:
            raise SandboxRefusedError("this key is outside the job's scope")
        return Path(reply["path"])


type Parser = Callable[[Mapping[str, Any], ScopedStorage], Mapping[str, Any]]


def channel() -> TextIO:
    requests = os.fdopen(os.dup(1), "w")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return requests


def parser_of(target: str) -> Parser:
    module, _, name = target.partition(":")
    return getattr(importlib.import_module(module), name)


def outcome(parser: Parser, arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    try:
        return {"result": dict(parser(arguments, storage))}
    except Exception as error:
        code = getattr(error, "code", None)
        if isinstance(code, str):
            return {"refusal": code}
        return {"crash": type(error).__name__}


def main() -> None:
    requests = channel()
    token = os.environ.pop(TOKEN_VARIABLE, "")
    sys.addaudithook(guard)
    request = json.loads(sys.stdin.readline())
    sys.path.extend(request.get("paths", []))
    parser = parser_of(request["target"])
    requests.write(json.dumps({"ready": True}) + "\n")
    requests.flush()
    storage = ScopedStorage(token, sys.stdin, requests)
    message = outcome(parser, request["arguments"], storage)
    requests.write(json.dumps(message) + "\n")
    requests.flush()


if __name__ == "__main__":
    main()
