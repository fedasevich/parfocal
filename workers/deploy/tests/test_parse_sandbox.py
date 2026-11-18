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
    def __init__(
        self, listed: Sequence[RemoteEntry] | None = None, exit_code: int | None = None
    ) -> None:
        self.listed = listed
        self.code = exit_code
        self.copied_in: list[Path] = []
        self.copied_out: list[Path] = []
        self.made: list[Path] = []
        self.removed: list[Path] = []
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

    async def remove(self, remote: Path) -> None:
        self.removed.append(remote)

    async def entries(self, remote: Path) -> list[RemoteEntry]:
        if self.listed is not None:
            return list(self.listed)
        return await asyncio.to_thread(listed_in, remote)

    async def exit_code(self) -> int | None:
        return self.code

    async def terminate(self) -> None:
        if self.process is not None and self.process.returncode is None:
            self.process.kill()
            await self.process.wait()
        self.terminated = True
        self.code = 137 if self.code is None else self.code


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
    sandbox_killed = SandboxChild(FakeSandbox(exit_code=137), LostExit(), tmp_path)
    crashed = SandboxChild(FakeSandbox(), FakeExit(1), tmp_path)
    assert await killed.killed_for_memory()
    assert await sandbox_killed.killed_for_memory()
    assert not await crashed.killed_for_memory()


class LostExit(FakeExit):
    def __init__(self) -> None:
        super().__init__(0)

    async def wait(self) -> int:
        raise ConnectionError


class MemoryKilledSandbox(FakeSandbox):
    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> LocalProcess:
        process = await super().exec(command, environment, work_dir)
        self.code = 137
        return process


async def test_a_parse_killed_by_the_sandbox_memory_cap_ends_as_too_large(tmp_path: Path) -> None:
    sandbox = MemoryKilledSandbox()

    async def fetcher(_key: str) -> Path:
        assert sandbox.process is not None
        sandbox.process.kill()
        await sandbox.process.wait()
        return tmp_path / "never"

    with pytest.raises(StepFailedError) as raised:
        await parse_isolated(
            "parfocal_ingest.parse_jobs:identify_upload",
            {"key": UPLOAD_KEY, "name": "slide.tiff"},
            SCOPE,
            fetcher,
            tmp_path / "work",
            ParseLimits(launcher=launcher_with(sandbox)),
        )
    assert raised.value.code == Failure.PARSE_TOO_LARGE
    assert sandbox.terminated


def test_the_ingest_function_parses_in_the_sandbox() -> None:
    assert isinstance(launcher_of(modal_app.PARSE_LAUNCHER), SandboxLauncher)


def written_extra(folder: Path) -> Path:
    extra = folder / "annotations.geojson"
    extra.write_text("{}")
    return extra


async def test_declared_inputs_are_passed_into_the_sandbox_before_the_parse(
    tmp_path: Path,
) -> None:
    slide = modal_app.REPOSITORY / "packages/test-fixtures/synthetic/synthetic-jpeg.tiff"
    extra = await asyncio.to_thread(written_extra, tmp_path)
    sandbox = FakeSandbox()

    async def fetcher(_key: str) -> Path:
        return slide

    await parse_isolated(
        "parfocal_ingest.parse_jobs:identify_upload",
        {"key": UPLOAD_KEY, "name": slide.name},
        SCOPE,
        fetcher,
        tmp_path / "work",
        ParseLimits(launcher=launcher_with(sandbox)),
        inputs=(extra,),
    )
    assert sandbox.copied_in == [extra, slide]


SYNTHETIC = modal_app.REPOSITORY / "packages/test-fixtures/synthetic/synthetic-jpeg.tiff"


class Factory:
    def __init__(self) -> None:
        self.made: list[FakeSandbox] = []
        self.now = 0.0

    async def create(self) -> FakeSandbox:
        sandbox = FakeSandbox()
        self.made.append(sandbox)
        return sandbox

    def launcher(self) -> SandboxLauncher:
        return SandboxLauncher(self.create, clock=lambda: self.now)


async def job_parse(
    launcher: SandboxLauncher, work: Path, parser: str, arguments: Mapping[str, Any]
) -> dict[str, Any]:
    async def fetcher(key: str) -> Path:
        assert key == UPLOAD_KEY
        return SYNTHETIC

    return await parse_isolated(
        f"parfocal_ingest.parse_jobs:{parser}",
        {"key": UPLOAD_KEY, **arguments},
        SCOPE,
        fetcher,
        work,
        ParseLimits(launcher=launcher),
        keep=True,
    )


async def five_steps(launcher: SandboxLauncher, work: Path) -> None:
    identified = await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    await job_parse(launcher, work, "scan_upload", identified)
    await job_parse(launcher, work, "validate_upload", identified)
    index = output_folder(work, "index")
    await job_parse(launcher, work, "index_upload", {**identified, "out": str(index)})
    derive = output_folder(work, "derive")
    wanted = {"previews": True, "tissue": True, "restricted": False}
    await job_parse(launcher, work, "derive_upload", {**identified, **wanted, "out": str(derive)})


async def test_the_five_steps_of_one_job_share_one_sandbox_and_one_copy_of_the_slide(
    tmp_path: Path,
) -> None:
    factory = Factory()
    launcher = factory.launcher()
    work = tmp_path / "job"
    await five_steps(launcher, work)
    [sandbox] = factory.made
    assert sandbox.copied_in == [SYNTHETIC]
    assert not sandbox.terminated
    outputs = work / "outputs"
    assert sandbox.removed == [outputs / "index", outputs / "derive", outputs / "index"]
    await launcher.release(work)
    assert sandbox.terminated
    assert launcher.kept == {}


async def test_two_jobs_never_share_a_sandbox(tmp_path: Path) -> None:
    factory = Factory()
    launcher = factory.launcher()
    await job_parse(launcher, tmp_path / "a", "identify_upload", {"name": SYNTHETIC.name})
    await job_parse(launcher, tmp_path / "b", "identify_upload", {"name": SYNTHETIC.name})
    first, second = factory.made
    assert first.copied_in == second.copied_in == [SYNTHETIC]


async def test_a_failed_step_ends_its_sandbox_and_the_next_step_starts_a_fresh_one(
    tmp_path: Path,
) -> None:
    factory = Factory()
    launcher = factory.launcher()
    work = tmp_path / "job"
    await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    with pytest.raises(StepFailedError):
        await job_parse(launcher, work, "scan_upload", {"format": "no-such-format"})
    await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    first, second = factory.made
    assert first.terminated
    assert second.copied_in == [SYNTHETIC]


async def test_a_sandbox_that_died_or_nears_its_lifetime_is_replaced(tmp_path: Path) -> None:
    factory = Factory()
    launcher = factory.launcher()
    work = tmp_path / "job"
    await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    factory.made[0].code = 137
    await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    factory.now = launcher.lifetime - launcher.step_seconds
    await job_parse(launcher, work, "identify_upload", {"name": SYNTHETIC.name})
    assert len(factory.made) == 3
    assert all(sandbox.copied_in == [SYNTHETIC] for sandbox in factory.made)
    assert factory.made[1].terminated


async def test_a_single_parse_never_keeps_its_sandbox(tmp_path: Path) -> None:
    factory = Factory()
    launcher = factory.launcher()

    async def fetcher(_key: str) -> Path:
        return SYNTHETIC

    await parse_isolated(
        "parfocal_ingest.parse_jobs:identify_upload",
        {"key": UPLOAD_KEY, "name": SYNTHETIC.name},
        SCOPE,
        fetcher,
        tmp_path,
        ParseLimits(launcher=launcher),
    )
    assert factory.made[0].terminated
    assert launcher.kept == {}
