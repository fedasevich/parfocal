import asyncio
import contextlib
import os
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import modal
from modal.stream_type import StreamType
from modal.types import FileType

from parfocal_common.ingest import Failure, Refusal
from parfocal_common.jobs import StepFailedError
from parfocal_ingest.isolation import MAX_MESSAGE_BYTES, OUTPUT_LIMIT_BYTES, ChildProcess
from parfocal_ingest.settings import PARSE_MEMORY_MIB, PARSE_SECONDS

OUTPUTS = "outputs"
KILLED_EXIT_CODES = frozenset({137, -9})
EXIT_WAIT_SECONDS = 10.0
PARSE_SANDBOX_OPTIONS: dict[str, Any] = {
    "block_network": True,
    "memory": (PARSE_MEMORY_MIB, PARSE_MEMORY_MIB),
    "timeout": int(PARSE_SECONDS),
}


@dataclass(frozen=True)
class RemoteEntry:
    name: str
    size: int
    regular: bool


class RemoteProcess(Protocol):
    async def write(self, data: bytes) -> None: ...

    def chunks(self) -> AsyncIterator[bytes]: ...

    async def wait(self) -> int: ...


class Sandbox(Protocol):
    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> RemoteProcess: ...

    async def make_directory(self, remote: Path) -> None: ...

    async def copy_in(self, local: Path, remote: Path) -> None: ...

    async def copy_out(self, remote: Path, local: Path) -> None: ...

    async def entries(self, remote: Path) -> list[RemoteEntry]: ...

    async def exit_code(self) -> int | None: ...

    async def terminate(self) -> None: ...


type SandboxFactory = Callable[[], Awaitable[Sandbox]]


def plain_name(name: str) -> bool:
    return bool(name) and name not in {".", ".."} and "/" not in name and "\0" not in name


def checked(entries: Sequence[RemoteEntry], limit: int) -> list[RemoteEntry]:
    total = 0
    for entry in entries:
        if not entry.regular or not plain_name(entry.name):
            raise StepFailedError(Refusal.UNREADABLE)
        total += entry.size
        if entry.size > limit or total > limit:
            raise StepFailedError(Failure.PARSE_TOO_LARGE)
    return list(entries)


def output_folders(work_dir: Path) -> list[Path]:
    outputs = work_dir / OUTPUTS
    if not outputs.is_dir():
        return []
    return sorted(folder for folder in outputs.iterdir() if folder.is_dir())


class SandboxChild:
    def __init__(
        self,
        sandbox: Sandbox,
        process: RemoteProcess,
        work_dir: Path,
        output_limit: int = OUTPUT_LIMIT_BYTES,
    ) -> None:
        self.sandbox = sandbox
        self.process = process
        self.chunks = process.chunks()
        self.work_dir = work_dir
        self.output_limit = output_limit
        self.pending = b""
        self.delivered: set[Path] = set()

    async def write(self, data: bytes) -> None:
        try:
            await self.process.write(data)
        except Exception as error:
            raise ConnectionError(type(error).__name__) from error

    async def next_chunk(self) -> bytes:
        try:
            return await anext(self.chunks, b"")
        except Exception:
            return b""

    async def readline(self) -> bytes:
        while b"\n" not in self.pending:
            if len(self.pending) > MAX_MESSAGE_BYTES:
                return b""
            chunk = await self.next_chunk()
            if not chunk:
                return b""
            self.pending += chunk
        line, _, self.pending = self.pending.partition(b"\n")
        return line + b"\n" if len(line) <= MAX_MESSAGE_BYTES else b""

    async def over_memory(self) -> None:
        await asyncio.Event().wait()

    async def killed_for_memory(self) -> bool:
        try:
            code = await asyncio.wait_for(self.process.wait(), EXIT_WAIT_SECONDS)
        except Exception:
            code = None
        if code in KILLED_EXIT_CODES:
            return True
        try:
            return await asyncio.wait_for(self.sandbox.exit_code(), EXIT_WAIT_SECONDS) in (
                KILLED_EXIT_CODES
            )
        except Exception:
            return False

    async def deliver(self, path: Path) -> Path:
        if path not in self.delivered:
            await self.sandbox.copy_in(path, path)
            self.delivered.add(path)
        return path

    async def collect(self) -> None:
        for folder in output_folders(self.work_dir):
            total = 0
            for entry in checked(await self.sandbox.entries(folder), self.output_limit):
                local = folder / entry.name
                await self.sandbox.copy_out(local, local)
                total += await asyncio.to_thread(os.path.getsize, local)
                if total > self.output_limit:
                    raise StepFailedError(Failure.PARSE_TOO_LARGE)

    async def stop(self) -> None:
        with contextlib.suppress(Exception):
            await self.sandbox.terminate()


@dataclass(frozen=True)
class SandboxLauncher:
    create: SandboxFactory

    async def start(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> ChildProcess:
        sandbox = await self.create()
        try:
            await sandbox.make_directory(work_dir)
            for folder in output_folders(work_dir):
                await sandbox.make_directory(folder)
            process = await sandbox.exec(command, environment, work_dir)
        except BaseException:
            with contextlib.suppress(Exception):
                await sandbox.terminate()
            raise
        return SandboxChild(sandbox, process, work_dir)


class ModalProcess:
    def __init__(self, process: Any) -> None:
        self.process = process

    async def write(self, data: bytes) -> None:
        self.process.stdin.write(data)
        await self.process.stdin.drain.aio()

    async def chunks(self) -> AsyncIterator[bytes]:
        async for chunk in self.process.stdout:
            yield chunk if isinstance(chunk, bytes) else chunk.encode()

    async def wait(self) -> int:
        return await self.process.wait.aio()


class ModalSandbox:
    def __init__(self, sandbox: modal.Sandbox) -> None:
        self.sandbox = sandbox

    @classmethod
    async def create(
        cls, app: modal.App, image: modal.Image, options: Mapping[str, Any] = PARSE_SANDBOX_OPTIONS
    ) -> ModalSandbox:
        return cls(await modal.Sandbox.create.aio(app=app, image=image, **options))

    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> RemoteProcess:
        process = await self.sandbox.exec.aio(
            *command,
            workdir=str(work_dir),
            env=dict(environment),
            stderr=StreamType.DEVNULL,
            text=False,
        )
        return ModalProcess(process)

    async def make_directory(self, remote: Path) -> None:
        await self.sandbox.filesystem.make_directory.aio(str(remote))

    async def copy_in(self, local: Path, remote: Path) -> None:
        await self.sandbox.filesystem.copy_from_local.aio(local, str(remote))

    async def copy_out(self, remote: Path, local: Path) -> None:
        await self.sandbox.filesystem.copy_to_local.aio(str(remote), local)

    async def entries(self, remote: Path) -> list[RemoteEntry]:
        found = await self.sandbox.filesystem.list_files.aio(str(remote))
        return [
            RemoteEntry(
                entry.name,
                entry.size,
                entry.type == FileType.FILE and entry.symlink_target is None,
            )
            for entry in found
        ]

    async def exit_code(self) -> int | None:
        return await self.sandbox.poll.aio()

    async def terminate(self) -> None:
        await self.sandbox.terminate.aio()


def hydrated_image(image: modal.Image) -> modal.Image:
    return modal.Image.from_id(image.object_id)


def modal_launcher(
    app: modal.App, image: modal.Image, options: Mapping[str, Any] = PARSE_SANDBOX_OPTIONS
) -> SandboxLauncher:
    async def create() -> Sandbox:
        return await ModalSandbox.create(app, hydrated_image(image), options)

    return SandboxLauncher(create)


def ingest_launcher() -> SandboxLauncher:
    from parfocal_deploy.modal_app import IMAGE, app

    return modal_launcher(app, IMAGE)
