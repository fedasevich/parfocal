import asyncio
import gzip
import hashlib
import json
import shutil
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass, field, replace
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Any

import httpx2
from sqlalchemy import select

from parfocal_api.deidentified import held_privacy, keeps_restricted_images
from parfocal_api.restricted_images import delete_restricted_images
from parfocal_api.slide_ingest import SlideFacts, publish_slide, record_refusal, upload_of
from parfocal_api.tables import UploadStatus, job_steps
from parfocal_common.ingest import (
    KIND,
    LEASE_SECONDS,
    STEP_NAMES,
    Failure,
    RestrictedImage,
    original_key,
    original_suffix,
    restricted_key,
    restricted_ranges_key,
    slide_prefix,
)
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.settings import load_settings
from parfocal_ingest.associated import associated_images
from parfocal_ingest.identify import Format, Identified, Refusal
from parfocal_ingest.identifying_text import ranges_file
from parfocal_ingest.isolation import JobScope, JobTokens, ParseLimits, parse_isolated
from parfocal_ingest.overview_levels import OVERVIEW_LEVELS_NAME, overview_levels
from parfocal_ingest.parse_jobs import READER_ERRORS, unpacked_in
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.settings import DEFAULT_COPY_PART_BYTES, IngestSettings
from parfocal_ingest.thumbnail import previews
from parfocal_ingest.tile_index import index_document, tile_index
from parfocal_ingest.tissue import tissue_mask

__all__ = ["INGEST", "STEP_NAMES", "Resources", "ingest_workflow"]

HASH_CHUNK_BYTES = 1024 * 1024
PARSERS = "parfocal_ingest.parse_jobs"
UNIT_PREVIEWS = 0
UNIT_TISSUE = 1
UNIT_RESTRICTED = 2
TILE_INDEX_NAME = "tile-index.json"


@dataclass(frozen=True)
class Resources:
    storage: StorageLocation
    work_dir: Path
    copy_part_bytes: int = DEFAULT_COPY_PART_BYTES
    store_class: type[ObjectStore] = ObjectStore
    link_trusted_origins: tuple[str, ...] = ()
    link_read_seconds: float = 30.0
    link_fetch_seconds: float = 3600.0
    parse_limits: ParseLimits = field(default_factory=ParseLimits)
    parse_tokens: JobTokens = field(default_factory=JobTokens)


@cache
def resources_from_environment() -> Resources:
    settings = load_settings(IngestSettings)
    return Resources(
        storage=settings.storage(),
        work_dir=Path(settings.ingest_work_dir),
        copy_part_bytes=settings.ingest_copy_part_bytes,
        link_trusted_origins=tuple(settings.link_trusted_origins),
        link_read_seconds=settings.link_read_seconds,
        link_fetch_seconds=settings.link_fetch_seconds,
        parse_limits=ParseLimits(
            memory_mib=settings.ingest_parse_memory_mib,
            seconds=settings.ingest_parse_seconds,
            user=settings.ingest_parse_user,
        ),
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


async def opened(context: Context) -> tuple[Path, Identified, Pyramid]:
    results = await earlier_results(context.step)
    await fetch(context)
    identified = identified_of(results)
    path = await asyncio.to_thread(unpacked_in, context.folder, context.local, identified)
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


def object_path(context: Context, key: str) -> Path:
    return context.folder / "objects" / hashlib.sha256(key.encode()).hexdigest()


async def fetch_for_parser(context: Context, key: str) -> Path:
    if key == context.upload.object_key:
        await fetch(context)
        return context.local
    target = object_path(context, key)
    target.parent.mkdir(parents=True, exist_ok=True)
    await context.store.download(key, target)
    return target


async def parsed(
    context: Context, parser: str, arguments: Mapping[str, Any], slide_id: uuid.UUID | None = None
) -> Mapping[str, Any]:
    upload = context.upload

    async def fetcher(key: str) -> Path:
        return await fetch_for_parser(context, key)

    return await parse_isolated(
        f"{PARSERS}:{parser}",
        {"key": upload.object_key, **arguments},
        JobScope(upload.tenant_id, slide_id, (upload.object_key,)),
        fetcher,
        context.folder,
        context.resources.parse_limits,
        context.resources.parse_tokens,
    )


async def identify_step(context: Context) -> Mapping[str, Any]:
    return await parsed(context, "identify_upload", {"name": context.upload.stored_name})


async def scan(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    return await parsed(context, "scan_upload", results["identify"])


async def validate(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    return await parsed(context, "validate_upload", results["identify"], slide_id_of(results))


def level_table(found: Pyramid) -> bytes:
    return json.dumps(asdict(found), separators=(",", ":")).encode()


def slide_id_of(results: Mapping[str, Mapping[str, Any]]) -> uuid.UUID:
    return uuid.UUID(str(results["quarantine"]["slide_id"]))


async def index(context: Context) -> Mapping[str, Any]:
    results = await earlier_results(context.step)
    path, identified, found = await opened(context)
    prefix = slide_prefix(context.upload.tenant_id, slide_id_of(results))
    await context.store.put_object(f"{prefix}levels.json", level_table(found), "application/json")
    tiles = await asyncio.to_thread(tile_index, path, identified, found)
    derived = None
    if tiles is not None and identified.format is not None:
        derived = await asyncio.to_thread(overview_levels, path, identified.format, found)
    if tiles is not None and derived is not None:
        await context.store.put_object(
            f"{prefix}{OVERVIEW_LEVELS_NAME}", derived.data, "image/tiff"
        )
        tiles["overviewLevels"] = derived.reference()
    if tiles is not None:
        await context.store.put_object(
            f"{prefix}{TILE_INDEX_NAME}",
            gzip.compress(index_document(tiles), mtime=0),
            "application/json",
            content_encoding="gzip",
        )
    return {
        "levels": len(found.levels),
        "tile_index": tiles is not None,
        "overview_levels": None if derived is None else list(derived.downsamples),
    }


async def derive(context: Context) -> Mapping[str, Any]:
    step = context.step
    results = await earlier_results(step)
    slide_id = slide_id_of(results)
    tenant_id = context.upload.tenant_id
    public = slide_prefix(tenant_id, slide_id)
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
        facts = {
            "cell": mask.cell,
            "threshold": mask.threshold,
            "fraction": mask.fraction,
            "box": mask.box.facts() if mask.box else None,
        }
        await context.store.put_object(
            f"{public}tissue.json", json.dumps(facts).encode(), "application/json"
        )
        async with step.transaction() as connection:
            await step.mark_unit(connection, UNIT_TISSUE)
    if UNIT_RESTRICTED not in done:
        async with step.transaction() as connection:
            mode = await held_privacy(connection, context.upload.row.project_id)
        if keeps_restricted_images(mode):
            for image in await asyncio.to_thread(associated_images, path, found):
                key = restricted_key(tenant_id, slide_id, RestrictedImage(image.kind.value))
                await context.store.put_object(key, image.data, image.media_type)
        async with step.transaction() as connection:
            await step.mark_unit(connection, UNIT_RESTRICTED)
    ranges = await asyncio.to_thread(ranges_file, context.local)
    await context.store.put_object(
        restricted_ranges_key(tenant_id, slide_id), ranges, "application/json"
    )
    present = [
        image.value
        for image in RestrictedImage
        if await context.store.head_object(restricted_key(tenant_id, slide_id, image)) is not None
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
        kept = keeps_restricted_images(await held_privacy(connection, upload.row.project_id))
        if not kept:
            facts = replace(facts, restricted_images=[])
        published = await publish_slide(connection, upload.row, facts)
    if not kept:
        await delete_restricted_images(context.store, upload.tenant_id, slide_id)
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
