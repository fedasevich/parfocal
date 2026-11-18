import asyncio
import contextlib
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
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
JOB_SANDBOX_SECONDS = 3 * int(PARSE_SECONDS)
IDLE_SANDBOX_SECONDS = 300
PARSE_SANDBOX_OPTIONS: dict[str, Any] = {
    "block_network": True,
    "memory": (PARSE_MEMORY_MIB, PARSE_MEMORY_MIB),
    "timeout": JOB_SANDBOX_SECONDS,
    "idle_timeout": IDLE_SANDBOX_SECONDS,
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

    async def remove(self, remote: Path) -> None: ...

    async def entries(self, remote: Path) -> list[RemoteEntry]: ...

    async def exit_code(self) -> int | None: ...

    async def terminate(self) -> None: ...


type SandboxFactory = Callable[[], Awaitable[Sandbox]]


async def terminated(sandbox: Sandbox) -> None:
    with contextlib.suppress(Exception):
        await sandbox.terminate()


@dataclass
class JobSandbox:
    sandbox: Sandbox
    expires: float
    delivered: set[Path] = field(default_factory=set)
    used: bool = False


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
        delivered: set[Path] | None = None,
        kept: Callable[[], None] | None = None,
    ) -> None:
        self.sandbox = sandbox
        self.process = process
        self.chunks = process.chunks()
        self.work_dir = work_dir
        self.output_limit = output_limit
        self.pending = b""
        self.delivered = set() if delivered is None else delivered
        self.kept = kept

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

    async def exited_cleanly(self) -> bool:
        try:
            return await asyncio.wait_for(self.process.wait(), EXIT_WAIT_SECONDS) == 0
        except Exception:
            return False

    async def stop(self, clean: bool = False) -> None:
        if clean and self.kept is not None and await self.exited_cleanly():
            self.kept()
            return
        await terminated(self.sandbox)


@dataclass
class SandboxLauncher:
    create: SandboxFactory
    lifetime: float = JOB_SANDBOX_SECONDS
    step_seconds: float = PARSE_SECONDS
    clock: Callable[[], float] = time.monotonic
    kept: dict[Path, JobSandbox] = field(default_factory=dict)

    async def fresh(self) -> JobSandbox:
        return JobSandbox(await self.create(), self.clock() + self.lifetime)

    async def reusable(self, work_dir: Path) -> JobSandbox | None:
        held = self.kept.pop(work_dir, None)
        if held is None:
            return None
        if held.expires - self.clock() > self.step_seconds:
            try:
                if await asyncio.wait_for(held.sandbox.exit_code(), EXIT_WAIT_SECONDS) is None:
                    return held
            except Exception:
                pass
        await terminated(held.sandbox)
        return None

    async def opened(
        self,
        held: JobSandbox,
        command: Sequence[str],
        environment: Mapping[str, str],
        work_dir: Path,
        keep: bool,
    ) -> ChildProcess:
        sandbox = held.sandbox
        try:
            await sandbox.make_directory(work_dir)
            for folder in output_folders(work_dir):
                if held.used:
                    with contextlib.suppress(Exception):
                        await sandbox.remove(folder)
                await sandbox.make_directory(folder)
            process = await sandbox.exec(command, environment, work_dir)
        except BaseException:
            await terminated(sandbox)
            raise

        def kept() -> None:
            held.used = True
            self.kept[work_dir] = held

        return SandboxChild(
            sandbox, process, work_dir, delivered=held.delivered, kept=kept if keep else None
        )

    async def start(
        self,
        command: Sequence[str],
        environment: Mapping[str, str],
        work_dir: Path,
        keep: bool = False,
    ) -> ChildProcess:
        held = await self.reusable(work_dir) if keep else None
        if held is not None:
            with contextlib.suppress(Exception):
                return await self.opened(held, command, environment, work_dir, keep)
        return await self.opened(await self.fresh(), command, environment, work_dir, keep)

    async def release(self, work_dir: Path) -> None:
        held = self.kept.pop(work_dir, None)
        if held is not None:
            await terminated(held.sandbox)


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

    async def remove(self, remote: Path) -> None:
        await self.sandbox.filesystem.remove.aio(str(remote), recursive=True)

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
