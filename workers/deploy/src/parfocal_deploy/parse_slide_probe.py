import asyncio
import json
import shutil
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import modal

from parfocal_deploy.modal_app import app_image
from parfocal_deploy.parse_sandbox import (
    ModalSandbox,
    RemoteEntry,
    RemoteProcess,
    SandboxLauncher,
    hydrated_image,
)

PROBE_APP = "parfocal-parse-slide-probe"
SLIDE_VOLUME = "parfocal-parse-slide-probe"
SLIDE_MOUNT = "/slides"
SLIDE_FETCHED = Path("/tmp/parse-slide-probe/fetched")
TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-00000000000b")
COPIES: list[dict[str, Any]] = []
CREATED: list[float] = []

IMAGE = app_image()
app = modal.App(PROBE_APP, image=IMAGE)
volume = modal.Volume.from_name(SLIDE_VOLUME, environment_name="dev")


class TimedSandbox:
    def __init__(self, inner: ModalSandbox) -> None:
        self.inner = inner

    async def exec(
        self, command: Sequence[str], environment: Mapping[str, str], work_dir: Path
    ) -> RemoteProcess:
        return await self.inner.exec(command, environment, work_dir)

    async def make_directory(self, remote: Path) -> None:
        await self.inner.make_directory(remote)

    async def copy_in(self, local: Path, remote: Path) -> None:
        started = time.monotonic()
        await self.inner.copy_in(local, remote)
        size = await asyncio.to_thread(lambda: local.stat().st_size)
        COPIES.append({"bytes": size, "seconds": round(time.monotonic() - started, 3)})

    async def copy_out(self, remote: Path, local: Path) -> None:
        await self.inner.copy_out(remote, local)

    async def remove(self, remote: Path) -> None:
        await self.inner.remove(remote)

    async def entries(self, remote: Path) -> list[RemoteEntry]:
        return await self.inner.entries(remote)

    async def exit_code(self) -> int | None:
        return await self.inner.exit_code()

    async def terminate(self) -> None:
        await self.inner.terminate()


def timed_launcher() -> SandboxLauncher:
    from parfocal_deploy.parse_slide_probe import IMAGE, app

    async def create() -> TimedSandbox:
        started = time.monotonic()
        sandbox = TimedSandbox(await ModalSandbox.create(app, hydrated_image(IMAGE)))
        CREATED.append(round(time.monotonic() - started, 3))
        return sandbox

    return SandboxLauncher(create)


async def outcome(work: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
    try:
        return await work()
    except Exception as error:
        return {
            "raised": type(error).__name__,
            "code": getattr(error, "code", None),
            "message": str(error)[:300],
        }


async def five_steps(
    slide: Path, launcher_path: str | None, work: Path
) -> tuple[dict[str, float], dict[str, Any]]:
    from parfocal_ingest.isolation import (
        JobScope,
        ParseLimits,
        launcher_of,
        output_folder,
        parse_isolated,
        release_parse,
    )

    key = f"t/{TENANT}/q/slide-probe/original{slide.suffix}"
    limits = ParseLimits(launcher=launcher_of(launcher_path))
    scope = JobScope(TENANT, SLIDE, (key,))
    timings: dict[str, float] = {}
    found: dict[str, Any] = {}

    async def fetcher(asked: str) -> Path:
        assert asked == key
        return slide

    async def step(name: str, target: str, arguments: dict[str, Any]) -> dict[str, Any]:
        started = time.monotonic()
        result = await outcome(
            lambda: parse_isolated(
                f"parfocal_ingest.parse_jobs:{target}",
                {"key": key, **arguments},
                scope,
                fetcher,
                work,
                limits,
                keep=True,
            )
        )
        timings[name] = round(time.monotonic() - started, 3)
        return result

    identified = await step("identify", "identify_upload", {"name": slide.name})
    found["identify"] = {name: identified.get(name) for name in ("format", "raised", "code")}
    if "raised" in identified:
        await release_parse(limits, work)
        return timings, found
    scanned = await step("scan", "scan_upload", identified)
    found["scan"] = {name: scanned.get(name) for name in ("raised", "code")}
    validated = await step("validate", "validate_upload", identified)
    found["validate"] = {name: validated.get(name) for name in ("levels", "raised", "code")}
    indexed = await step(
        "index", "index_upload", {**identified, "out": str(output_folder(work, "index"))}
    )
    found["index"] = {name: indexed.get(name) for name in ("levels", "raised", "code")}
    wanted = {"previews": True, "tissue": True, "restricted": False}
    derived = await step(
        "derive",
        "derive_upload",
        {**identified, **wanted, "out": str(output_folder(work, "derive"))},
    )
    found["derive"] = {name: derived.get(name) for name in ("raised", "code")}
    await release_parse(limits, work)
    timings["total"] = round(sum(timings.values()), 3)
    return timings, found


def fetched_slide(name: str) -> Path:
    SLIDE_FETCHED.mkdir(parents=True, exist_ok=True)
    target = SLIDE_FETCHED / name
    shutil.copyfile(Path(SLIDE_MOUNT) / name, target)
    return target


@app.function(timeout=3600, memory=4096, volumes={SLIDE_MOUNT: volume})
async def slide_probe(name: str) -> dict[str, Any]:
    started = time.monotonic()
    slide = await asyncio.to_thread(fetched_slide, name)
    report: dict[str, Any] = {
        "slide_bytes": slide.stat().st_size,
        "fetch_seconds": round(time.monotonic() - started, 3),
    }
    sandbox_timings, sandbox_found = await five_steps(
        slide, f"{__name__}:timed_launcher", Path("/tmp/parse-slide-probe/sandbox")
    )
    report["sandbox"] = {
        "timings": sandbox_timings,
        "found": sandbox_found,
        "sandboxes_created": CREATED,
        "copies": COPIES,
    }
    local_timings, local_found = await five_steps(slide, None, Path("/tmp/parse-slide-probe/local"))
    report["local"] = {"timings": local_timings, "found": local_found}
    report["sandboxes_left"] = [
        {"id": sandbox.object_id, "exit": await sandbox.poll.aio()}
        async for sandbox in modal.Sandbox.list.aio(app_id=app.app_id)
    ]
    return report


@app.local_entrypoint()
def main(name: str = "test_001.tif") -> None:
    print(json.dumps(slide_probe.remote(name), indent=2))
