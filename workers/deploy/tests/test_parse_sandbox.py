import asyncio
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.ingest import Failure, Refusal
from parfocal_common.jobs import StepFailedError
from parfocal_deploy import modal_app
from parfocal_deploy.parse_sandbox import (
    RemoteEntry,
    SandboxChild,
    SandboxLauncher,
    checked,
)
from parfocal_ingest.isolation import (
    MAX_MESSAGE_BYTES,
    JobScope,
    ParseLimits,
    launcher_of,
    output_folder,
    parse_isolated,
    required_output,
)
from parfocal_ingest.parse_jobs import LEVELS_OUTPUT

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-00000000000a")
UPLOAD_KEY = f"t/{TENANT}/q/upload-1/original.tiff"
SCOPE = JobScope(TENANT, SLIDE, (UPLOAD_KEY,))


class LocalProcess:
    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self.process = process

    async def write(self, data: bytes) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(data)
        await self.process.stdin.drain()

    async def chunks(self) -> AsyncIterator[bytes]:
        assert self.process.stdout is not None
        while chunk := await self.process.stdout.read(65536):
            yield chunk

    async def wait(self) -> int:
        return await self.process.wait()


def listed_in(remote: Path) -> list[RemoteEntry]:
    return [
        RemoteEntry(path.name, path.stat().st_size, path.is_file() and not path.is_symlink())
        for path in remote.iterdir()
    ]


class FakeSandbox:
    def __init__(self, listed: Sequence[RemoteEntry] | None = None) -> None:
        self.listed = listed
        self.copied_in: list[Path] = []
        self.copied_out: list[Path] = []
        self.made: list[Path] = []
        self.terminated = False
        self.process: asyncio.subprocess.Process | None = None

    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> LocalProcess:
        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=dict(environment),
            cwd=work_dir,
        )
        return LocalProcess(self.process)

    async def make_directory(self, remote: Path) -> None:
        self.made.append(remote)

    async def copy_in(self, local: Path, remote: Path) -> None:
        assert local == remote
        self.copied_in.append(remote)

    async def copy_out(self, remote: Path, local: Path) -> None:
        assert local == remote
        self.copied_out.append(remote)

    async def entries(self, remote: Path) -> list[RemoteEntry]:
        if self.listed is not None:
            return list(self.listed)
        return await asyncio.to_thread(listed_in, remote)

    async def terminate(self) -> None:
        if self.process is not None and self.process.returncode is None:
            self.process.kill()
            await self.process.wait()
        self.terminated = True


class RefusingSandbox(FakeSandbox):
    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> LocalProcess:
        raise ConnectionError


def launcher_with(sandbox: FakeSandbox) -> SandboxLauncher:
    async def create() -> FakeSandbox:
        return sandbox

    return SandboxLauncher(create)


async def test_a_slide_is_parsed_in_the_sandbox_with_its_file_passed_in_and_outputs_copied_out(
    tmp_path: Path,
) -> None:
    slide = modal_app.REPOSITORY / "packages/test-fixtures/synthetic/synthetic-jpeg.tiff"
    sandbox = FakeSandbox()
    limits = ParseLimits(launcher=launcher_with(sandbox))
    work = tmp_path / "work"

    async def fetcher(key: str) -> Path:
        assert key == UPLOAD_KEY
        return slide

    async def parse(parser: str, arguments: Mapping[str, Any]) -> dict[str, Any]:
        return await parse_isolated(
            f"parfocal_ingest.parse_jobs:{parser}",
            {"key": UPLOAD_KEY, **arguments},
            SCOPE,
            fetcher,
            work,
            limits,
        )

    identified = await parse("identify_upload", {"name": slide.name})
    out = output_folder(work, "index")
    indexed = await parse("index_upload", {**identified, "out": str(out)})
    assert indexed["levels"] >= 1
    assert required_output(out, LEVELS_OUTPUT)
    assert sandbox.copied_in == [slide, slide]
    assert out / LEVELS_OUTPUT in sandbox.copied_out
    assert out in sandbox.made
    assert sandbox.terminated


async def test_the_sandbox_is_terminated_when_the_child_cannot_start(tmp_path: Path) -> None:
    sandbox = RefusingSandbox()
    with pytest.raises(ConnectionError):
        await launcher_with(sandbox).start(("python",), {}, tmp_path)
    assert sandbox.terminated


@pytest.mark.parametrize(
    ("entries", "code"),
    [
        ([RemoteEntry("link", 10, regular=False)], Refusal.UNREADABLE),
        ([RemoteEntry("../escape", 10, regular=True)], Refusal.UNREADABLE),
        ([RemoteEntry("big", 11, regular=True)], Failure.PARSE_TOO_LARGE),
        (
            [RemoteEntry("a", 6, regular=True), RemoteEntry("b", 6, regular=True)],
            Failure.PARSE_TOO_LARGE,
        ),
    ],
)
def test_outputs_that_are_not_plain_files_within_the_cap_are_never_copied(
    entries: list[RemoteEntry], code: str
) -> None:
    with pytest.raises(StepFailedError) as raised:
        checked(entries, 10)
    assert raised.value.code == code


async def test_a_hostile_output_folder_copies_nothing_back(tmp_path: Path) -> None:
    output_folder(tmp_path, "index")
    sandbox = FakeSandbox([RemoteEntry("ok", 1, regular=True), RemoteEntry("x", 9, False)])
    child = SandboxChild(sandbox, FakeExit(0), tmp_path)
    with pytest.raises(StepFailedError):
        await child.collect()
    assert sandbox.copied_out == []


class FakeExit:
    def __init__(self, code: int, output: bytes = b"") -> None:
        self.code = code
        self.output = output

    async def write(self, data: bytes) -> None:
        return None

    async def chunks(self) -> AsyncIterator[bytes]:
        if self.output:
            yield self.output

    async def wait(self) -> int:
        return self.code


async def test_an_overlong_reply_line_ends_the_conversation(tmp_path: Path) -> None:
    child = SandboxChild(FakeSandbox(), FakeExit(0, b"x" * (MAX_MESSAGE_BYTES + 2)), tmp_path)
    assert await child.readline() == b""


async def test_a_child_killed_by_the_memory_limit_counts_as_too_large(tmp_path: Path) -> None:
    killed = SandboxChild(FakeSandbox(), FakeExit(137), tmp_path)
    crashed = SandboxChild(FakeSandbox(), FakeExit(1), tmp_path)
    assert await killed.killed_for_memory()
    assert not await crashed.killed_for_memory()


def test_the_ingest_function_parses_in_the_sandbox() -> None:
    assert isinstance(launcher_of(modal_app.PARSE_LAUNCHER), SandboxLauncher)
