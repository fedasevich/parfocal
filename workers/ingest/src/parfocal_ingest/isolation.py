import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import os
import secrets
import shutil
import signal
import stat
import sys
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from parfocal_common.ingest import FAILURES, Failure, Refusal, slide_prefixes
from parfocal_common.jobs import StepFailedError
from parfocal_ingest import isolated_child
from parfocal_ingest.isolated_child import TOKEN_VARIABLE
from parfocal_ingest.settings import PARSE_MEMORY_MIB, PARSE_SECONDS

__all__ = [
    "JobScope",
    "JobTokens",
    "ParseLimits",
    "ParseNotStartedError",
    "output_folder",
    "parse_isolated",
    "read_output",
    "required_output",
]

CHILD_SCRIPT = isolated_child.__file__
MAX_MESSAGE_BYTES = 1024 * 1024
MIB = 1024 * 1024
KIB = 1024
OUTPUT_LIMIT_BYTES = 1024 * MIB

type Fetcher = Callable[[str], Awaitable[Path]]


class ParseNotStartedError(RuntimeError):
    pass


def import_paths() -> list[str]:
    return [str(Path(entry).resolve()) for entry in sys.path if entry]


@dataclass(frozen=True)
class ParseLimits:
    memory_mib: int = PARSE_MEMORY_MIB
    seconds: float = PARSE_SECONDS
    poll_seconds: float = 0.1
    user: str | None = None


@dataclass(frozen=True)
class JobScope:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID | None = None
    keys: tuple[str, ...] = ()

    def allows(self, key: str) -> bool:
        if key in self.keys:
            return True
        if self.slide_id is None:
            return False
        return key.startswith(slide_prefixes(self.tenant_id, self.slide_id))

    def claims(self) -> dict[str, Any]:
        return {
            "tenant": str(self.tenant_id),
            "slide": None if self.slide_id is None else str(self.slide_id),
            "keys": list(self.keys),
        }


def scope_of_claims(claims: Mapping[str, Any]) -> JobScope:
    slide = claims["slide"]
    return JobScope(
        uuid.UUID(claims["tenant"]),
        None if slide is None else uuid.UUID(slide),
        tuple(str(key) for key in claims["keys"]),
    )


def encoded(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decoded(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass(frozen=True)
class JobTokens:
    secret: bytes = field(default_factory=lambda: secrets.token_bytes(32))

    def signature(self, payload: str) -> bytes:
        return hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()

    def issue(self, scope: JobScope) -> str:
        claims = {**scope.claims(), "nonce": secrets.token_hex(8)}
        payload = encoded(json.dumps(claims, sort_keys=True).encode())
        return f"{payload}.{encoded(self.signature(payload))}"

    def scope_of(self, token: object) -> JobScope | None:
        if not isinstance(token, str):
            return None
        payload, _, signature = token.partition(".")
        try:
            if not hmac.compare_digest(decoded(signature), self.signature(payload)):
                return None
            return scope_of_claims(json.loads(decoded(payload)))
        except ValueError, KeyError, TypeError:
            return None


def child_environment(token: str, work_dir: Path) -> dict[str, str]:
    return {
        TOKEN_VARIABLE: token,
        "HOME": str(work_dir),
        "TMPDIR": str(work_dir),
        "PATH": os.defpath,
    }


def output_folder(work_dir: Path, name: str) -> Path:
    folder = work_dir / "outputs" / name
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    return folder


def read_output(folder: Path, name: str, limit: int = OUTPUT_LIMIT_BYTES) -> bytes | None:
    if not name or name in {".", ".."} or "/" in name:
        raise ValueError(name)
    try:
        directory = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise StepFailedError(Refusal.UNREADABLE) from None
    try:
        handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    except FileNotFoundError:
        return None
    except OSError:
        raise StepFailedError(Refusal.UNREADABLE) from None
    finally:
        os.close(directory)
    with os.fdopen(handle, "rb") as file:
        if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
            raise StepFailedError(Refusal.UNREADABLE)
        data = file.read(limit + 1)
    if len(data) > limit:
        raise StepFailedError(Failure.PARSE_TOO_LARGE)
    return data


def required_output(folder: Path, name: str) -> bytes:
    data = read_output(folder, name)
    if data is None:
        raise StepFailedError(Refusal.UNREADABLE)
    return data


def hand_over(work_dir: Path, user: str) -> None:
    shutil.chown(work_dir, user)
    for folder, names, _files in work_dir.walk():
        for name in names:
            shutil.chown(folder / name, user)


def proc_resident_bytes(statm: Path) -> int | None:
    try:
        return int(statm.read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    except OSError, IndexError, ValueError:
        return None


async def resident_bytes(pid: int) -> int | None:
    if sys.platform == "linux":
        return proc_resident_bytes(Path(f"/proc/{pid}/statm"))
    probe = await asyncio.create_subprocess_exec(
        "ps",
        "-o",
        "rss=",
        "-p",
        str(pid),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    output, _ = await probe.communicate()
    text = output.decode().strip()
    return int(text) * KIB if text.isdigit() else None


async def memory_exceeded(pid: int, limits: ParseLimits) -> None:
    while True:
        found = await resident_bytes(pid)
        if found is not None and found > limits.memory_mib * MIB:
            return
        await asyncio.sleep(limits.poll_seconds)


def stop(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)


class Conversation:
    def __init__(
        self, process: asyncio.subprocess.Process, tokens: JobTokens, fetcher: Fetcher
    ) -> None:
        assert process.stdin is not None
        assert process.stdout is not None
        self.writer = process.stdin
        self.reader = process.stdout
        self.tokens = tokens
        self.fetcher = fetcher
        self.ready = False

    def broken(self) -> Exception:
        if self.ready:
            return StepFailedError(Refusal.UNREADABLE)
        return ParseNotStartedError("the parse process stopped before loading its parser")

    async def send(self, message: Mapping[str, Any]) -> None:
        try:
            self.writer.write((json.dumps(message) + "\n").encode())
            await self.writer.drain()
        except ConnectionError:
            raise self.broken() from None

    async def receive(self) -> dict[str, Any]:
        try:
            line = await self.reader.readline()
            message: object = json.loads(line) if line else None
        except ValueError:
            raise self.broken() from None
        if not isinstance(message, dict):
            raise self.broken()
        return {str(name): value for name, value in message.items()}

    async def serve(self, message: Mapping[str, Any]) -> None:
        key = message["fetch"]
        scope = self.tokens.scope_of(message.get("token"))
        if not isinstance(key, str) or scope is None or not scope.allows(key):
            await self.send({"refused": str(key)})
            return
        await self.send({"path": str(await self.fetcher(key))})

    async def run(self, request: Mapping[str, Any]) -> dict[str, Any]:
        await self.send(request)
        while True:
            message = await self.receive()
            if message.get("ready") is True:
                self.ready = True
                continue
            if not self.ready:
                raise self.broken()
            if "fetch" in message:
                await self.serve(message)
                continue
            result = message.get("result")
            if isinstance(result, dict):
                return {str(name): value for name, value in result.items()}
            code = message.get("refusal")
            if isinstance(code, str) and code in FAILURES:
                raise StepFailedError(code)
            raise StepFailedError(Refusal.UNREADABLE)


async def supervised(
    process: asyncio.subprocess.Process, talk: Awaitable[dict[str, Any]], limits: ParseLimits
) -> dict[str, Any]:
    talking = asyncio.ensure_future(talk)
    watching = asyncio.ensure_future(memory_exceeded(process.pid, limits))
    try:
        done, _ = await asyncio.wait(
            {talking, watching}, timeout=limits.seconds, return_when=asyncio.FIRST_COMPLETED
        )
        if talking in done:
            return talking.result()
        raise StepFailedError(
            Failure.PARSE_TOO_LARGE if watching in done else Failure.PARSE_TOO_SLOW
        )
    finally:
        for task in (talking, watching):
            task.cancel()
        stop(process)
        await process.wait()


async def parse_isolated(
    target: str,
    arguments: Mapping[str, Any],
    scope: JobScope,
    fetcher: Fetcher,
    work_dir: Path,
    limits: ParseLimits | None = None,
    tokens: JobTokens | None = None,
    paths: Sequence[str] = (),
) -> dict[str, Any]:
    chosen = limits or ParseLimits()
    issuer = tokens or JobTokens()
    await asyncio.to_thread(work_dir.mkdir, parents=True, exist_ok=True)
    if chosen.user is not None:
        await asyncio.to_thread(hand_over, work_dir, chosen.user)
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        CHILD_SCRIPT,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=child_environment(issuer.issue(scope), work_dir),
        cwd=work_dir,
        start_new_session=True,
        limit=MAX_MESSAGE_BYTES,
        user=chosen.user,
    )
    conversation = Conversation(process, issuer, fetcher)
    request = {
        "target": target,
        "arguments": dict(arguments),
        "paths": [*import_paths(), *paths],
    }
    return await supervised(process, conversation.run(request), chosen)
