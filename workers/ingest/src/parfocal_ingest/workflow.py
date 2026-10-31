import asyncio
import hashlib
import json
import shutil
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Any

import httpx2
import openslide
import tifffile
from PIL import UnidentifiedImageError
from sqlalchemy import select
from wsidicom.errors import WsiDicomError

from parfocal_api.slide_ingest import SlideFacts, publish_slide, record_refusal, upload_of
from parfocal_api.tables import UploadStatus, job_steps
from parfocal_common.ingest import (
    KIND,
    LEASE_SECONDS,
    STEP_NAMES,
    Failure,
    original_key,
    original_suffix,
    restricted_prefix,
    slide_prefix,
)
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.settings import load_settings
from parfocal_ingest.associated import associated_images
from parfocal_ingest.identify import Format, Identified, Refusal, identify
from parfocal_ingest.integrity import check_integrity
from parfocal_ingest.pyramid import Pyramid, read_pyramid, unpack
from parfocal_ingest.settings import DEFAULT_COPY_PART_BYTES, IngestSettings
from parfocal_ingest.thumbnail import previews
from parfocal_ingest.tissue import tissue_mask

__all__ = ["INGEST", "STEP_NAMES", "Resources", "ingest_workflow"]

HASH_CHUNK_BYTES = 1024 * 1024
READER_ERRORS = (
    openslide.OpenSlideError,
    tifffile.TiffFileError,
    UnidentifiedImageError,
    WsiDicomError,
)
UNIT_PREVIEWS = 0
UNIT_TISSUE = 1
UNIT_RESTRICTED = 2
RESTRICTED_NAMES = {"label": "label.png", "macro": "macro.jpg"}


@dataclass(frozen=True)
class Resources:
    storage: StorageLocation
    work_dir: Path
    copy_part_bytes: int = DEFAULT_COPY_PART_BYTES
    store_class: type[ObjectStore] = ObjectStore


@cache
def resources_from_environment() -> Resources:
    settings = load_settings(IngestSettings)
    return Resources(
        storage=settings.storage(),
        work_dir=Path(settings.ingest_work_dir),
        copy_part_bytes=settings.ingest_copy_part_bytes,
    )


@dataclass(frozen=True)
class Upload:
    id: uuid.UUID
    tenant_id: uuid.UUID
    object_key: str
    size_bytes: int
    row: Any

    @property
    def stored_name(self) -> str:
        return PurePosixPath(self.object_key).name


@dataclass(frozen=True)
class Context:
    step: StepRun
    resources: Resources
    store: ObjectStore
    upload: Upload

    @property
    def folder(self) -> Path:
        return self.resources.work_dir / str(self.step.job_id)

    @property
    def local(self) -> Path:
        return self.folder / f"original{original_suffix(self.upload.stored_name)}"


type StepBody = Callable[[Context], Awaitable[Mapping[str, Any]]]


async def load_upload(step: StepRun) -> Upload:
    try:
        upload_id = uuid.UUID(str(step.input["upload_id"]))
    except KeyError, ValueError:
        raise StepFailedError(Failure.UPLOAD_MISSING) from None
    async with step.transaction() as connection:
        row = await upload_of(connection, upload_id)
    if row is None or row.status != UploadStatus.COMPLETED:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    return Upload(row.id, row.tenant_id, row.object_key, row.size_bytes, row)


async def earlier_results(step: StepRun) -> dict[str, Mapping[str, Any]]:
    async with step.transaction() as connection:
        rows = await connection.execute(
            select(job_steps.c.name, job_steps.c.result).where(job_steps.c.job_id == step.job_id)
        )
        return {row.name: row.result or {} for row in rows}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


async def fetch(context: Context) -> str | None:
    local = context.local
    if local.exists() and local.stat().st_size == context.upload.size_bytes:
        return None
    context.folder.mkdir(parents=True, exist_ok=True)
    partial = local.with_name(local.name + ".part")
    downloaded = await context.store.download(context.upload.object_key, partial)
    if downloaded.size != context.upload.size_bytes:
        partial.unlink(missing_ok=True)
        raise StepFailedError(Failure.SIZE_MISMATCH)
    partial.replace(local)
    return downloaded.sha256


def identified_of(results: Mapping[str, Mapping[str, Any]]) -> Identified:
    found = results["identify"]
    return Identified(Format(found["format"]), found.get("variant"))


def unpacked(context: Context, identified: Identified) -> Path:
    if identified.variant != "zip" or identified.format is None:
        return context.local
    target = context.folder / "unpacked"
    marker = context.folder / "unpacked.json"
    if marker.exists():
        return target / json.loads(marker.read_text())["path"]
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    found = unpack(context.local, target, identified.format)
    if isinstance(found, Refusal):
        raise StepFailedError(found)
    marker.write_text(json.dumps({"path": str(found.relative_to(target))}))
    return found


async def opened(context: Context) -> tuple[Path, Identified, Pyramid]:
    results = await earlier_results(context.step)
    await fetch(context)
    identified = identified_of(results)
    path = await asyncio.to_thread(unpacked, context, identified)
    found = await asyncio.to_thread(read_pyramid, path, identified)
    if isinstance(found, Refusal):
        raise StepFailedError(found)
    return path, identified, found


async def quarantine(context: Context) -> Mapping[str, Any]:
    stored = await context.store.head_object(context.upload.object_key)
    if stored is None:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    if stored != context.upload.size_bytes:
        raise StepFailedError(Failure.SIZE_MISMATCH)
    sha256 = await fetch(context) or await asyncio.to_thread(sha256_of, context.local)
    return {"bytes": stored, "sha256": sha256, "slide_id": str(uuid.uuid4())}


def identify_file(path: Path, name: str) -> Identified:
    with path.open("rb") as handle:
        return identify(handle, name)


async def identify_step(context: Context) -> Mapping[str, Any]:
    await fetch(context)
    found = await asyncio.to_thread(identify_file, context.local, context.upload.stored_name)
    if found.format is None:
        raise StepFailedError(found.refusal or Refusal.UNKNOWN)
    return {"format": found.format.value, "variant": found.variant}


async def scan(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    await fetch(context)
    refusal = await asyncio.to_thread(check_integrity, context.local, identified_of(results))
    if refusal is not None:
        raise StepFailedError(refusal)
    return {"clean": True}


async def validate(context: Context) -> Mapping[str, Any]:
    _, _, found = await opened(context)
    base = found.levels[0]
    return {
        "reader": found.reader.value,
        "width": base.width,
        "height": base.height,
        "levels": len(found.levels),
        "mpp_x": found.scale.mpp_x,
        "mpp_y": found.scale.mpp_y,
        "objective_power": found.scale.objective_power,
        "notices": [notice.value for notice in found.notices],
    }


def level_table(found: Pyramid) -> bytes:
    return json.dumps(asdict(found), separators=(",", ":")).encode()


def slide_id_of(results: Mapping[str, Mapping[str, Any]]) -> uuid.UUID:
    return uuid.UUID(str(results["quarantine"]["slide_id"]))


async def index(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    _, _, found = await opened(context)
    prefix = slide_prefix(context.upload.tenant_id, slide_id_of(results))
    await context.store.put_object(f"{prefix}levels.json", level_table(found), "application/json")
    return {"levels": len(found.levels)}


async def derive(context: Context) -> Mapping[str, Any]:
    step = context.step
    results = await earlier_results(step)
    slide_id = slide_id_of(results)
    public = slide_prefix(context.upload.tenant_id, slide_id)
    restricted = restricted_prefix(context.upload.tenant_id, slide_id)
    done = await step.done_units()
    path, identified, found = await opened(context)
    assert identified.format is not None
    if UNIT_PREVIEWS not in done:
        images = await asyncio.to_thread(previews, path, identified.format, found)
        await context.store.put_object(f"{public}thumbnail.jpg", images.thumbnail, "image/jpeg")
        await context.store.put_object(f"{public}overview.jpg", images.overview, "image/jpeg")
        async with step.transaction() as connection:
            await step.mark_unit(connection, UNIT_PREVIEWS)
    if UNIT_TISSUE not in done:
        mask = await asyncio.to_thread(tissue_mask, path, identified.format, found)
        await context.store.put_object(f"{public}tissue.png", mask.png(), "image/png")
        facts = {"cell": mask.cell, "threshold": mask.threshold, "fraction": mask.fraction}
        await context.store.put_object(
            f"{public}tissue.json", json.dumps(facts).encode(), "application/json"
        )
        async with step.transaction() as connection:
            await step.mark_unit(connection, UNIT_TISSUE)
    if UNIT_RESTRICTED not in done:
        for image in await asyncio.to_thread(associated_images, path, found):
            name = RESTRICTED_NAMES[image.kind.value]
            await context.store.put_object(f"{restricted}{name}", image.data, image.media_type)
        async with step.transaction() as connection:
            await step.mark_unit(connection, UNIT_RESTRICTED)
    present = [
        kind
        for kind, name in RESTRICTED_NAMES.items()
        if await context.store.head_object(f"{restricted}{name}") is not None
    ]
    return {"units": 3, "restricted": present}


async def publish(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    upload = context.upload
    slide_id = slide_id_of(results)
    target = original_key(upload.tenant_id, slide_id, upload.stored_name)
    if await context.store.head_object(target) != upload.size_bytes:
        await context.store.copy_object(
            upload.object_key, target, upload.size_bytes, context.resources.copy_part_bytes
        )
    validated = results["validate"]
    identified = results["identify"]
    facts = SlideFacts(
        slide_id=slide_id,
        format=identified["format"],
        variant=identified.get("variant"),
        reader=validated["reader"],
        width=validated["width"],
        height=validated["height"],
        level_count=validated["levels"],
        mpp_x=validated["mpp_x"],
        mpp_y=validated["mpp_y"],
        objective_power=validated["objective_power"],
        notices=validated["notices"],
        file_bytes=upload.size_bytes,
        sha256=results["quarantine"]["sha256"],
        original_key=target,
        restricted_images=results["derive"]["restricted"],
    )
    async with context.step.transaction() as connection:
        published = await publish_slide(connection, upload.row, facts)
    await context.store.delete_object(upload.object_key)
    shutil.rmtree(context.folder, ignore_errors=True)
    return {"slide_id": str(slide_id), "published": published}


async def refuse(context: Context, code: str) -> None:
    async with context.step.transaction() as connection:
        await record_refusal(connection, context.upload.row, code)
    await context.store.delete_object(context.upload.object_key)
    shutil.rmtree(context.folder, ignore_errors=True)


def guarded(name: str, body: StepBody, resources: Callable[[], Resources]) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        chosen = resources()
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            store = chosen.store_class(chosen.storage, http)
            upload = await load_upload(step)
            context = Context(step, chosen, store, upload)
            try:
                try:
                    return await body(context)
                except READER_ERRORS as error:
                    raise StepFailedError(Refusal.UNREADABLE) from error
            except StepFailedError as failure:
                await refuse(context, failure.code)
                raise

    return Step(name, run)


BODIES: Mapping[str, StepBody] = {
    "quarantine": quarantine,
    "identify": identify_step,
    "scan": scan,
    "validate": validate,
    "index": index,
    "derive": derive,
    "publish": publish,
}


def ingest_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=KIND,
        steps=[guarded(name, BODIES[name], resources) for name in STEP_NAMES],
        lease_seconds=lease_seconds,
    )


INGEST = ingest_workflow(resources_from_environment)
