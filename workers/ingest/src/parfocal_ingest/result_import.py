import asyncio
import re
import shutil
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx2
import msgspec
import shapely
from shapely.geometry.base import BaseGeometry

from parfocal_api.numbering import reserve
from parfocal_api.result_imports import (
    import_target,
    known_objects,
    locked_result_upload,
    store_result_set,
)
from parfocal_api.result_sets import MAX_CLASSES, RegionRow, ResultSetDraft
from parfocal_api.slide_ingest import record_refusal, upload_of
from parfocal_api.tables import ResultObjectKind, UploadStatus
from parfocal_common.ingest import Failure
from parfocal_common.jobs import Step, StepFailedError, StepRun, Workflow
from parfocal_common.object_ids import Letter
from parfocal_common.result_imports import (
    KIND,
    LEASE_SECONDS,
    STEP_NAMES,
    ImportFailure,
    ImportNotice,
    ResultFormat,
    UploadKind,
    result_set_id_for,
    source_key,
)
from parfocal_ingest.matching import Known, Matching, match_regions
from parfocal_ingest.results import (
    ObjectKind,
    ReadResult,
    ResultObject,
    guess_mapping,
    header_of,
    read_geojson,
    read_parfocal_json,
    read_table,
)
from parfocal_ingest.workflow import Resources, resources_from_environment

__all__ = ["RESULT_IMPORT", "result_import_workflow"]

PARFOCAL_FORMAT = re.compile(rb'"format"\s*:\s*"parfocal-results"')
SNIFF_BYTES = 64 * 1024
NAME_LENGTH = 120
VERSION_LENGTH = 60
FILE_NAME_LENGTH = 255
SCORE_SCALE = 255
DEFAULT_NAMES: Mapping[ResultFormat, str] = {
    ResultFormat.GEOJSON: "GeoJSON import",
    ResultFormat.PARFOCAL_JSON: "Parfocal JSON import",
    ResultFormat.CSV: "CSV import",
}
LETTERS: Mapping[ObjectKind, tuple[Letter, ResultObjectKind]] = {
    ObjectKind.REGION: (Letter.REGION, ResultObjectKind.REGION),
    ObjectKind.ZONE: (Letter.ZONE, ResultObjectKind.ZONE),
}


class Model(msgspec.Struct):
    name: str | None = None
    version: str | None = None
    run_at: str | None = None


class ParfocalClass(msgspec.Struct):
    name: str


class ParfocalHeader(msgspec.Struct):
    model: Model | None = None
    classes: list[ParfocalClass] | None = None


@dataclass
class Parsed:
    format: ResultFormat
    read: ReadResult
    model: Model = field(default_factory=Model)
    declared_classes: list[str] = field(default_factory=list[str])


def format_for(data: bytes, stored: str | None) -> ResultFormat:
    if stored is not None:
        return ResultFormat(stored)
    if PARFOCAL_FORMAT.search(data[:SNIFF_BYTES]):
        return ResultFormat.PARFOCAL_JSON
    return ResultFormat.GEOJSON


def parfocal_header(data: bytes) -> ParfocalHeader:
    try:
        return msgspec.json.decode(data, type=ParfocalHeader)
    except msgspec.DecodeError, msgspec.ValidationError:
        return ParfocalHeader()


def read_file(data: bytes, stored_format: str | None) -> Parsed:
    chosen = format_for(data, stored_format)
    match chosen:
        case ResultFormat.GEOJSON:
            return Parsed(chosen, read_geojson(data))
        case ResultFormat.PARFOCAL_JSON:
            header = parfocal_header(data)
            return Parsed(
                chosen,
                read_parfocal_json(data),
                header.model or Model(),
                [item.name for item in header.classes or []],
            )
        case ResultFormat.CSV:
            try:
                mapping = guess_mapping(header_of(data))
            except UnicodeDecodeError:
                raise StepFailedError(ImportFailure.UNREADABLE) from None
            if mapping.polygon is None and (mapping.x is None or mapping.y is None):
                raise StepFailedError(ImportFailure.COLUMNS_UNMAPPED)
            return Parsed(chosen, read_table(data, mapping))


def class_key(name: str | None) -> str | None:
    cleaned = (name or "").strip()[:NAME_LENGTH]
    return cleaned.casefold() if cleaned else None


def class_list(parsed: Parsed, objects: Sequence[ResultObject]) -> list[str]:
    names: dict[str, str] = {}
    seen = [
        *parsed.declared_classes,
        *(item.class_name or "" for item in objects),
        *(name for item in objects for name in (item.probabilities or {})),
    ]
    for name in seen:
        key = class_key(name)
        if key is not None and key not in names:
            names[key] = name.strip()[:NAME_LENGTH]
    if len(names) > MAX_CLASSES:
        raise StepFailedError(ImportFailure.TOO_MANY_CLASSES)
    return list(names.values())


def scaled(value: float | None) -> int | None:
    if value is None:
        return None
    return max(0, min(SCORE_SCALE, round(value * SCORE_SCALE)))


def probabilities_of(item: ResultObject, classes: Sequence[str]) -> list[int] | None:
    if not item.probabilities:
        return None
    by_key = {class_key(name): value for name, value in item.probabilities.items()}
    return [scaled(by_key.get(class_key(name), 0.0)) or 0 for name in classes]


def produced_at(model: Model) -> datetime | None:
    if not model.run_at:
        return None
    try:
        return datetime.fromisoformat(model.run_at)
    except ValueError:
        return None


def draft_of(parsed: Parsed, classes: list[str], file_name: str) -> ResultSetDraft:
    name = (parsed.model.name or "").strip()[:NAME_LENGTH] or DEFAULT_NAMES[parsed.format]
    version = (parsed.model.version or "").strip()[:VERSION_LENGTH] or None
    return ResultSetDraft(
        name=name,
        model_version=version,
        source_file=file_name[:FILE_NAME_LENGTH],
        produced_at=produced_at(parsed.model),
        classes=classes,
    )


def matched(known: Sequence[tuple[int, str]], incoming: Sequence[BaseGeometry]) -> Matching:
    return match_regions([Known(number, shapely.from_wkt(wkt)) for number, wkt in known], incoming)


@dataclass(frozen=True)
class Upload:
    row: Any

    @property
    def id(self) -> uuid.UUID:
        return self.row.id

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.row.tenant_id


@dataclass(frozen=True)
class Context:
    step: StepRun
    resources: Resources
    store: Any
    upload: Upload

    @property
    def folder(self) -> Path:
        return self.resources.work_dir / str(self.step.job_id)

    @property
    def local(self) -> Path:
        return self.folder / "result"


async def load_upload(step: StepRun) -> Upload:
    try:
        upload_id = uuid.UUID(str(step.input["upload_id"]))
    except KeyError, ValueError:
        raise StepFailedError(Failure.UPLOAD_MISSING) from None
    async with step.transaction() as connection:
        row = await upload_of(connection, upload_id)
    if row is None or row.status != UploadStatus.COMPLETED or row.kind != UploadKind.RESULT:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    return Upload(row)


async def fetch(context: Context) -> bytes:
    row = context.upload.row
    stored = await context.store.head_object(row.object_key)
    if stored is None:
        raise StepFailedError(Failure.UPLOAD_MISSING)
    if stored != row.size_bytes:
        raise StepFailedError(Failure.SIZE_MISMATCH)
    context.folder.mkdir(parents=True, exist_ok=True)
    downloaded = await context.store.download(row.object_key, context.local)
    if downloaded.size != row.size_bytes:
        raise StepFailedError(Failure.SIZE_MISMATCH)
    return await asyncio.to_thread(context.local.read_bytes)


def objects_to_import(parsed: Parsed) -> tuple[list[ResultObject], int]:
    read = parsed.read
    if any(problem.where == "file" for problem in read.problems):
        raise StepFailedError(ImportFailure.UNREADABLE)
    shapes = [item for item in read.objects if item.kind in LETTERS]
    cells = sum(1 for item in read.objects if item.kind is ObjectKind.CELL)
    if not shapes:
        raise StepFailedError(ImportFailure.CELLS_ONLY if cells else ImportFailure.EMPTY)
    return shapes, cells


async def rows_of(
    connection: Any,
    upload: Any,
    slide_id: uuid.UUID,
    shapes: Sequence[ResultObject],
    classes: Sequence[str],
) -> list[RegionRow]:
    positions = {class_key(name): position for position, name in enumerate(classes)}
    rows: list[RegionRow] = []
    for kind, (letter, stored_kind) in LETTERS.items():
        items = [item for item in shapes if item.kind is kind]
        if not items:
            continue
        geometries = [item.geometry for item in items]
        known = await known_objects(connection, slide_id, stored_kind)
        matching = await asyncio.to_thread(matched, known, geometries)
        first = (
            await reserve(connection, upload.tenant_id, slide_id, letter, len(matching.new))
            if matching.new
            else 0
        )
        for item, number in zip(items, matching.numbers(first), strict=True):
            rows.append(
                RegionRow(
                    kind=stored_kind,
                    number=number,
                    wkt=item.geometry.wkt,
                    class_position=positions.get(class_key(item.class_name)),
                    score=scaled(item.score),
                    probabilities=probabilities_of(item, classes),
                )
            )
    return rows


async def import_step(context: Context) -> Mapping[str, Any]:
    upload = context.upload.row
    if upload.result_set_id is not None:
        return {"result_set_id": str(upload.result_set_id), "notices": []}
    data = await fetch(context)
    parsed = await asyncio.to_thread(read_file, data, upload.result_format)
    shapes, cells = objects_to_import(parsed)
    classes = class_list(parsed, shapes)
    set_id = result_set_id_for(upload.id)
    async with context.step.transaction() as connection:
        locked = await locked_result_upload(connection, upload.id)
        if locked is None or locked.slide_id is None:
            raise StepFailedError(ImportFailure.SLIDE_MISSING)
        slide = await import_target(connection, locked.slide_id)
        if slide is None:
            raise StepFailedError(ImportFailure.SLIDE_MISSING)
        rows = await rows_of(connection, locked, slide.id, shapes, classes)
        key = source_key(locked.tenant_id, slide.id, set_id, locked.file_name)
        await context.store.put_object(key, data, "application/octet-stream")
        draft = draft_of(parsed, classes, locked.file_name)
        await store_result_set(connection, locked, slide, set_id, draft, rows, context.step.job_id)
    notices = [
        *([ImportNotice.CELLS_NOT_IMPORTED.value] if cells else []),
        *([ImportNotice.OBJECTS_SKIPPED.value] if parsed.read.problems else []),
    ]
    await context.store.delete_object(upload.object_key)
    shutil.rmtree(context.folder, ignore_errors=True)
    return {
        "result_set_id": str(set_id),
        "regions": sum(1 for row in rows if row.kind is ResultObjectKind.REGION),
        "zones": sum(1 for row in rows if row.kind is ResultObjectKind.ZONE),
        "cells_not_imported": cells,
        "skipped": len(parsed.read.problems),
        "notices": notices,
    }


async def refuse(context: Context, code: str) -> None:
    async with context.step.transaction() as connection:
        await record_refusal(connection, context.upload.row, code)
    await context.store.delete_object(context.upload.row.object_key)
    shutil.rmtree(context.folder, ignore_errors=True)


def guarded(name: str, resources: Callable[[], Resources]) -> Step:
    async def run(step: StepRun) -> Mapping[str, Any]:
        chosen = resources()
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(60.0)) as http:
            store = chosen.store_class(chosen.storage, http)
            upload = await load_upload(step)
            context = Context(step, chosen, store, upload)
            try:
                return await import_step(context)
            except StepFailedError as failure:
                await refuse(context, failure.code)
                raise

    return Step(name, run)


def result_import_workflow(
    resources: Callable[[], Resources], lease_seconds: float = LEASE_SECONDS
) -> Workflow:
    return Workflow(
        kind=KIND,
        steps=[guarded(name, resources) for name in STEP_NAMES],
        lease_seconds=lease_seconds,
    )


RESULT_IMPORT = result_import_workflow(resources_from_environment)
