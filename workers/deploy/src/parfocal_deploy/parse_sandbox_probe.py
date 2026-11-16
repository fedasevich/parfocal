import asyncio
import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import modal

from parfocal_deploy.modal_app import REPOSITORY, app_image
from parfocal_deploy.parse_sandbox import PARSE_SANDBOX_OPTIONS, ModalSandbox, hydrated_image

PROBE_APP = "parfocal-parse-probe"
FIXTURE = "synthetic-jpeg.tiff"
FIXTURE_SOURCE = REPOSITORY / "packages/test-fixtures/synthetic" / FIXTURE
FIXTURE_REMOTE = f"/fixtures/{FIXTURE}"
BLOB_MIB = 100
OOM_LIMIT_MIB = 256
TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-00000000000a")
UPLOAD_KEY = f"t/{TENANT}/q/probe/original.tiff"
BOUNDARY_SCRIPT = """
import json, os, socket
found = {}
try:
    socket.create_connection(("1.1.1.1", 443), timeout=5).close()
    found["connect"] = "connected"
except OSError as error:
    found["connect"] = type(error).__name__
try:
    socket.getaddrinfo("modal.com", 443)
    found["resolve"] = "resolved"
except OSError as error:
    found["resolve"] = type(error).__name__
found["names"] = sorted(os.environ)
import sys
sys.path.insert(0, "/root")
import parfocal_ingest.parse_jobs
found["sources"] = parfocal_ingest.parse_jobs.__file__
print(json.dumps(found))
"""
OOM_SCRIPT = "b = bytearray(512 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\n"


def probe_image() -> modal.Image:
    base = app_image()
    if not modal.is_local():
        return base
    return base.add_local_file(FIXTURE_SOURCE, FIXTURE_REMOTE, copy=True)


IMAGE = probe_image()
app = modal.App(PROBE_APP, image=IMAGE)


async def timed[T](timings: dict[str, float], name: str, work: Callable[[], Awaitable[T]]) -> T:
    started = time.monotonic()
    result = await work()
    timings[name] = round(time.monotonic() - started, 3)
    return result


async def boundary(sandbox: ModalSandbox) -> dict[str, Any]:
    process = await sandbox.sandbox.exec.aio("python", "-I", "-c", BOUNDARY_SCRIPT)
    output = await process.stdout.read.aio()
    errors = await process.stderr.read.aio()
    code = await process.wait.aio()
    if code != 0:
        return {"exit": code, "stderr": errors[-2000:]}
    return json.loads(output)


async def parse_through_sandbox(timings: dict[str, float]) -> dict[str, Any]:
    from parfocal_deploy.parse_sandbox import modal_launcher
    from parfocal_ingest.isolation import (
        JobScope,
        ParseLimits,
        output_folder,
        parse_isolated,
        required_output,
    )
    from parfocal_ingest.parse_jobs import LEVELS_OUTPUT

    limits = ParseLimits(launcher=modal_launcher(app, IMAGE))
    work = Path("/tmp/parse-probe/job")
    scope = JobScope(TENANT, SLIDE, (UPLOAD_KEY,))

    async def fetcher(key: str) -> Path:
        assert key == UPLOAD_KEY
        return Path(FIXTURE_REMOTE)

    async def parse(parser: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await parse_isolated(
            f"parfocal_ingest.parse_jobs:{parser}",
            {"key": UPLOAD_KEY, **arguments},
            scope,
            fetcher,
            work,
            limits,
        )

    identified = await timed(
        timings, "identify_seconds", lambda: parse("identify_upload", {"name": FIXTURE})
    )
    out = output_folder(work, "index")
    indexed = await timed(
        timings, "index_seconds", lambda: parse("index_upload", {**identified, "out": str(out)})
    )
    return {
        "format": identified.get("format"),
        "levels": indexed["levels"],
        "levels_output_bytes": len(required_output(out, LEVELS_OUTPUT)),
    }


def written_blob() -> Path:
    blob = Path("/tmp/parse-probe/blob.bin")
    blob.parent.mkdir(parents=True, exist_ok=True)
    blob.write_bytes(os.urandom(BLOB_MIB * 1024 * 1024))
    return blob


def sizes(*paths: Path) -> list[int]:
    return [path.stat().st_size for path in paths]


async def transfer(sandbox: ModalSandbox, timings: dict[str, float]) -> dict[str, int]:
    blob = await asyncio.to_thread(written_blob)
    fixture = Path(FIXTURE_REMOTE)
    await timed(
        timings,
        "copy_fixture_seconds",
        lambda: sandbox.copy_in(fixture, Path("/tmp/in/fixture.tiff")),
    )
    await timed(
        timings, "copy_blob_seconds", lambda: sandbox.copy_in(blob, Path("/tmp/in/blob.bin"))
    )
    await timed(
        timings,
        "copy_blob_out_seconds",
        lambda: sandbox.copy_out(Path("/tmp/in/blob.bin"), Path("/tmp/parse-probe/back.bin")),
    )
    async with modal.Volume.ephemeral() as volume:

        async def upload() -> None:
            async with volume.batch_upload.aio() as batch:
                batch.put_file(blob, "/blob.bin")

        await timed(timings, "volume_upload_blob_seconds", upload)

        async def mounted() -> None:
            options = {**PARSE_SANDBOX_OPTIONS, "volumes": {"/data": volume}}
            other = await ModalSandbox.create(app, hydrated_image(IMAGE), options)
            try:
                process = await other.sandbox.exec.aio("wc", "-c", "/data/blob.bin")
                await process.wait.aio()
            finally:
                await other.terminate()

        await timed(timings, "volume_sandbox_read_blob_seconds", mounted)
    fixture_bytes, blob_bytes = await asyncio.to_thread(sizes, fixture, blob)
    return {"fixture_bytes": fixture_bytes, "blob_bytes": blob_bytes}


async def out_of_memory() -> int:
    options = {**PARSE_SANDBOX_OPTIONS, "memory": (OOM_LIMIT_MIB, OOM_LIMIT_MIB)}
    sandbox = await ModalSandbox.create(app, hydrated_image(IMAGE), options)
    try:
        process = await sandbox.sandbox.exec.aio("python", "-c", OOM_SCRIPT)
        return await process.wait.aio()
    finally:
        await sandbox.terminate()


@app.function(timeout=900)
async def probe() -> dict[str, Any]:
    timings: dict[str, float] = {}
    report: dict[str, Any] = {"image": IMAGE.object_id, "timings": timings}
    sandbox = await timed(
        timings,
        "create_seconds",
        lambda: ModalSandbox.create(app, hydrated_image(IMAGE)),
    )
    try:
        report["boundary"] = await timed(timings, "first_exec_seconds", lambda: boundary(sandbox))
        report["transfer"] = await transfer(sandbox, timings)
    finally:
        await sandbox.terminate()
    report["parse"] = await parse_through_sandbox(timings)
    report["oom_exit_code"] = await timed(timings, "oom_seconds", out_of_memory)
    return report


@app.local_entrypoint()
def main() -> None:
    print(json.dumps(probe.remote(), indent=2))
