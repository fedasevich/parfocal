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
DRAWN_KIND = "region"
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


def probe_launcher() -> Any:
    from parfocal_deploy.parse_sandbox import modal_launcher
    from parfocal_deploy.parse_sandbox_probe import IMAGE, app

    return modal_launcher(app, IMAGE)


def small_launcher() -> Any:
    from parfocal_deploy.parse_sandbox import modal_launcher
    from parfocal_deploy.parse_sandbox_probe import IMAGE, app

    options = {**PARSE_SANDBOX_OPTIONS, "memory": (OOM_LIMIT_MIB, OOM_LIMIT_MIB)}
    return modal_launcher(app, IMAGE, options)


def written_geojson(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / "annotations.geojson"
    polygon = [[0, 0], [64, 0], [64, 64], [0, 64], [0, 0]]
    feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [polygon]},
        "properties": {"parfocal": {"kind": DRAWN_KIND, "class_key": 1}},
    }
    source.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))
    return source


async def outcome(work: Callable[[], Awaitable[dict[str, Any]]]) -> Any:
    try:
        return await work()
    except Exception as error:
        return {
            "raised": type(error).__name__,
            "code": getattr(error, "code", None),
            "message": str(error)[:300],
        }


async def parse_through_sandbox(timings: dict[str, float]) -> dict[str, Any]:
    from parfocal_ingest.isolation import (
        JobScope,
        ParseLimits,
        launcher_of,
        output_folder,
        parse_isolated,
        read_output,
        required_output,
    )
    from parfocal_ingest.parse_jobs import LEVELS_OUTPUT, THUMBNAIL_OUTPUT

    launcher = launcher_of(f"{__name__}:probe_launcher")
    limits = ParseLimits(launcher=launcher)
    work = Path("/tmp/parse-probe/job")
    scope = JobScope(TENANT, SLIDE, (UPLOAD_KEY,))

    async def fetcher(key: str) -> Path:
        assert key == UPLOAD_KEY
        return Path(FIXTURE_REMOTE)

    async def parse(
        target: str,
        arguments: dict[str, Any],
        chosen: ParseLimits = limits,
        inputs: tuple[Path, ...] = (),
    ) -> dict[str, Any]:
        return await parse_isolated(
            target if ":" in target else f"parfocal_ingest.parse_jobs:{target}",
            {"key": UPLOAD_KEY, **arguments},
            scope,
            fetcher,
            work,
            chosen,
            inputs=inputs,
        )

    found: dict[str, Any] = {}
    identified = await timed(
        timings, "identify_seconds", lambda: parse("identify_upload", {"name": FIXTURE})
    )
    found["format"] = identified.get("format")
    found["scan"] = await timed(timings, "scan_seconds", lambda: parse("scan_upload", identified))
    validated = await timed(
        timings, "validate_seconds", lambda: parse("validate_upload", identified)
    )
    found["validate_levels"] = validated.get("levels")
    index_out = output_folder(work, "index")
    indexed = await timed(
        timings,
        "index_seconds",
        lambda: parse("index_upload", {**identified, "out": str(index_out)}),
    )
    found["index_levels"] = indexed["levels"]
    found["levels_output_bytes"] = len(required_output(index_out, LEVELS_OUTPUT))
    derive_out = output_folder(work, "derive")
    wanted = {"previews": True, "tissue": True, "restricted": False}
    await timed(
        timings,
        "derive_seconds",
        lambda: parse("derive_upload", {**identified, **wanted, "out": str(derive_out)}),
    )
    found["thumbnail_bytes"] = len(required_output(derive_out, THUMBNAIL_OUTPUT))
    geojson = await asyncio.to_thread(written_geojson, work)
    patch_out = output_folder(work, "patches")
    patched = await timed(
        timings,
        "patch_seconds",
        lambda: outcome(
            lambda: parse(
                "parfocal_ingest.patch_export:patch_slide",
                {
                    "slide_id": str(SLIDE),
                    "geojson": str(geojson),
                    "level": 0,
                    "tile_size": 64,
                    "out": str(patch_out),
                },
                inputs=(geojson,),
            )
        ),
    )
    found["patch"] = {key: patched[key] for key in patched if key != "slide"}
    found["patch_zip_bytes"] = len(read_output(patch_out, "patches.zip") or b"")
    found["too_large"] = await timed(
        timings,
        "too_large_seconds",
        lambda: outcome(
            lambda: parse(
                "parfocal_deploy.parse_probe_jobs:allocate",
                {},
                ParseLimits(launcher=launcher_of(f"{__name__}:small_launcher")),
            )
        ),
    )
    found["too_slow"] = await timed(
        timings,
        "too_slow_seconds",
        lambda: outcome(
            lambda: parse(
                "parfocal_deploy.parse_probe_jobs:linger",
                {"seconds": 120},
                ParseLimits(seconds=10, launcher=launcher),
            )
        ),
    )
    found["not_started"] = await outcome(
        lambda: parse("parfocal_deploy.parse_probe_jobs:missing", {})
    )
    return found


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
    report["sandboxes_left"] = [
        {"id": sandbox.object_id, "exit": await sandbox.poll.aio()}
        async for sandbox in modal.Sandbox.list.aio(app_id=app.app_id)
    ]
    return report


@app.local_entrypoint()
def main() -> None:
    print(json.dumps(probe.remote(), indent=2))
