import asyncio
import re
import shutil
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx2
import msgspec
import numpy as np
import shapely
from numpy.typing import NDArray
from shapely.geometry.base import BaseGeometry
from sqlalchemy import select, update

from parfocal_api.numbering import reserve
from parfocal_api.result_imports import (
    cell_sets,
    import_target,
    known_objects,
    locked_result_upload,
    store_result_set,
)
from parfocal_api.result_sets import MAX_CLASSES, RegionRow, ResultSetDraft
from parfocal_api.slide_ingest import record_refusal, upload_of
from parfocal_api.tables import (
    ResultObjectKind,
    UploadStatus,
    class_mappings,
    project_classes,
    slides,
    uploads,
)
from parfocal_common.cell_chunks import UNCLASSIFIED, ChunkError
from parfocal_common.chunk_store import ChunkEntry, read_summary
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
    ScoreDefault,
    UploadKind,
    result_set_id_for,
    result_set_prefix,
    source_key,
)
from parfocal_common.result_store import MissingObjectError, ObjectResultStore
from parfocal_ingest.cell_import import (
    NAME_LENGTH,
    CellCollector,
    IncomingCells,
    class_key,
    innermost_regions,
    latest_per_number,
    scaled,
)
from parfocal_ingest.chunk_builder import CellTable, plan_chunks, write_table
from parfocal_ingest.import_checks import (
    Choices,
    KnownClasses,
    SlideFrame,
    Tally,
    heatmap_problems,
    problems_of,
    raster_shape,
)
from parfocal_ingest.json_stream import JsonArray
from parfocal_ingest.matching import Known, Matching, cell_distance, match_regions, pair_centres
from parfocal_ingest.results import (
    ColumnMapping,
    ObjectKind,
    ReadResult,
    ResultObject,
    guess_mapping,
    stream_geojson,
    stream_parfocal_json,
    stream_table,
    table_head,
)
from parfocal_ingest.workflow import Resources, resources_from_environment

__all__ = ["RESULT_IMPORT", "result_import_workflow"]

PARFOCAL_FORMAT = re.compile(rb'"format"\s*:\s*"parfocal-results"')
SNIFF_BYTES = 64 * 1024
VERSION_LENGTH = 60
FILE_NAME_LENGTH = 255
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
    shapes: list[ResultObject]
    cells: IncomingCells
    skipped: int = 0
    unreadable: bool = False
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


@dataclass
class Reading:
    collector: CellCollector
    tally: Tally
    choices: Choices = field(default_factory=Choices)
    shapes: list[ResultObject] = field(default_factory=list[ResultObject])
    skipped: int = 0
    unreadable: bool = False

    def take(self, batches: Iterable[ReadResult]) -> None:
        for batch in batches:
            files = sum(1 for problem in batch.problems if problem.where == "file")
            self.unreadable = self.unreadable or files > 0
            self.skipped += len(batch.problems) - files
            self.tally.take(batch)
            batch.objects[:] = [self.choices.adjusted(item) for item in batch.objects]
            self.shapes += [item for item in batch.objects if item.kind in LETTERS]
            self.collector.add([item for item in batch.objects if item.kind is ObjectKind.CELL])
            batch.objects.clear()

    def parsed(self, chosen: ResultFormat, header: ParfocalHeader | None = None) -> Parsed:
        model = header.model if header is not None else None
        declared = header.classes if header is not None else None
        return Parsed(
            chosen,
            self.shapes,
            self.collector.finish(),
            self.skipped,
            self.unreadable,
            model or Model(),
            [item.name for item in declared or []],
        )


def table_mapping(path: Path) -> tuple[ColumnMapping, Any]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as text:
            header, dialect = table_head(text)
    except UnicodeDecodeError:
        raise StepFailedError(ImportFailure.UNREADABLE) from None
    mapping = guess_mapping(header)
    if mapping.polygon is None and (mapping.x is None or mapping.y is None):
        raise StepFailedError(ImportFailure.COLUMNS_UNMAPPED)
    return mapping, dialect


def read_path(path: Path, stored_format: str | None) -> Parsed:
    return read_checked(path, stored_format)[0]


def read_checked(
    path: Path,
    stored_format: str | None,
    frame: SlideFrame | None = None,
    choices: Choices | None = None,
) -> tuple[Parsed, Tally]:
    with path.open("rb") as handle:
        chosen = format_for(handle.read(SNIFF_BYTES), stored_format)
    tally = Tally(chosen, frame or SlideFrame())
    with CellCollector(path.parent) as collector:
        reading = Reading(collector, tally, choices or Choices())
        return read_format(path, chosen, reading), tally


def read_format(path: Path, chosen: ResultFormat, reading: Reading) -> Parsed:
    match chosen:
        case ResultFormat.GEOJSON:
            with path.open("rb") as handle:
                reading.take(stream_geojson(handle))
            return reading.parsed(chosen)
        case ResultFormat.PARFOCAL_JSON:
            with path.open("rb") as handle:
                scan = JsonArray(handle, "objects")
                reading.take(stream_parfocal_json(scan))
            return reading.parsed(chosen, parfocal_header(bytes(scan.rest)))
        case ResultFormat.CSV:
            mapping, dialect = table_mapping(path)
            with path.open(encoding="utf-8-sig", newline="") as text:
                reading.take(stream_table(text, mapping, dialect))
            return reading.parsed(chosen)
        case ResultFormat.HEATMAP:
            raise StepFailedError(ImportFailure.HEATMAP_NOT_STORED)


def class_list(parsed: Parsed) -> list[str]:
    names: dict[str, str] = {}
    seen = [
        *parsed.declared_classes,
        *(item.class_name or "" for item in parsed.shapes),
        *parsed.cells.class_names.names,
        *(name for item in parsed.shapes for name in (item.probabilities or {})),
        *parsed.cells.probability_names.names,
    ]
    for name in seen:
        key = class_key(name)
        if key is not None and key not in names:
            names[key] = name.strip()[:NAME_LENGTH]
    overflow = parsed.cells.class_names.overflow or parsed.cells.probability_names.overflow
    if overflow or len(names) > MAX_CLASSES:
        raise StepFailedError(ImportFailure.TOO_MANY_CLASSES)
    return list(names.values())


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


async def fetch(context: Context) -> Path:
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
    return context.local


def objects_to_import(parsed: Parsed) -> None:
    if parsed.unreadable:
        raise StepFailedError(ImportFailure.UNREADABLE)
    if not parsed.shapes and not len(parsed.cells):
        raise StepFailedError(ImportFailure.EMPTY)


@dataclass(frozen=True)
class NumberedRegion:
    number: int
    geometry: BaseGeometry


def positions_of(classes: Sequence[str]) -> dict[str | None, int]:
    return {class_key(name): position for position, name in enumerate(classes)}


async def rows_of(
    connection: Any,
    upload: Any,
    slide_id: uuid.UUID,
    shapes: Sequence[ResultObject],
    classes: Sequence[str],
) -> tuple[list[RegionRow], list[NumberedRegion]]:
    positions = positions_of(classes)
    rows: list[RegionRow] = []
    numbered: list[NumberedRegion] = []
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
            if stored_kind is ResultObjectKind.REGION:
                numbered.append(NumberedRegion(number, item.geometry))
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
    return rows, numbered


def summary_centres(arrays: Mapping[str, memoryview]) -> NDArray[np.float64]:
    xs = np.asarray(arrays["x"], dtype=np.float64)
    ys = np.asarray(arrays["y"], dtype=np.float64)
    return np.column_stack((xs, ys))


async def known_cells(
    store: Any, tenant_id: uuid.UUID, slide_id: uuid.UUID, set_ids: Sequence[uuid.UUID]
) -> tuple[NDArray[np.int64], NDArray[np.float64]]:
    results = ObjectResultStore(store)
    numbers: list[NDArray[np.int64]] = []
    centres: list[NDArray[np.float64]] = []
    for set_id in set_ids:
        try:
            summary = await read_summary(results, result_set_prefix(tenant_id, slide_id, set_id))
        except MissingObjectError, ChunkError:
            continue
        numbers.append(np.asarray(summary.numbers(), dtype=np.int64))
        centres.append(summary_centres(summary.arrays))
    if not numbers:
        return np.zeros(0, dtype=np.int64), np.zeros((0, 2), dtype=np.float64)
    return latest_per_number(np.concatenate(numbers), np.concatenate(centres))


def class_positions(names: Sequence[str], classes: Sequence[str], missing: int) -> NDArray[Any]:
    positions = positions_of(classes)
    found = [positions.get(class_key(name), missing) for name in names]
    return np.array([*found, missing], dtype=np.int64)


def cell_probabilities(incoming: IncomingCells, classes: Sequence[str]) -> NDArray[np.uint8]:
    lookup = class_positions(incoming.probability_names.names, classes, -1)
    columns = lookup[incoming.probability_name]
    kept = columns >= 0
    found = np.zeros((len(incoming), len(classes)), dtype=np.uint8)
    found[incoming.probability_owner[kept], columns[kept]] = incoming.probability_scaled[kept]
    return found


def cell_table(
    incoming: IncomingCells,
    numbers: NDArray[np.int64],
    regions: Sequence[NumberedRegion],
    classes: Sequence[str],
) -> tuple[CellTable, bool]:
    lookup = class_positions(incoming.class_names.names, classes, UNCLASSIFIED).astype(np.uint8)
    keep = incoming.probability_cells == len(incoming)
    dropped = not keep and incoming.probability_cells > 0
    inside = innermost_regions(
        incoming.outlines.centres, [(region.number, region.geometry) for region in regions]
    )
    nucleus = incoming.nucleus
    table = CellTable(
        numbers=numbers,
        points=incoming.outlines.points,
        offsets=incoming.outlines.offsets,
        class_index=lookup[incoming.class_ids],
        score=incoming.scores,
        region=inside.astype(np.int64),
        probs=cell_probabilities(incoming, classes) if keep else None,
        nucleus_points=None if nucleus is None else nucleus.points,
        nucleus_offsets=None if nucleus is None else nucleus.offsets,
    )
    return table, dropped


@dataclass(frozen=True)
class WrittenCells:
    entries: tuple[ChunkEntry, ...] = ()
    inherited: int = 0
    probabilities_dropped: bool = False


async def write_imported_cells(
    context: Context,
    connection: Any,
    slide: Any,
    set_id: uuid.UUID,
    incoming: IncomingCells,
    regions: Sequence[NumberedRegion],
    classes: Sequence[str],
) -> WrittenCells:
    if not len(incoming):
        return WrittenCells()
    tenant_id = context.upload.tenant_id
    set_ids = await cell_sets(connection, slide.id)
    known_numbers, known_centres = await known_cells(context.store, tenant_id, slide.id, set_ids)
    matching = await asyncio.to_thread(
        pair_centres,
        known_numbers,
        known_centres,
        incoming.outlines.centres,
        cell_distance(slide.mpp_x),
    )
    del known_numbers, known_centres
    first = (
        await reserve(connection, tenant_id, slide.id, Letter.CELL, len(matching.new))
        if len(matching.new)
        else 0
    )
    table, dropped = await asyncio.to_thread(
        cell_table, incoming, matching.numbers(first), regions, classes
    )
    plan = await asyncio.to_thread(plan_chunks, tenant_id, slide.id, set_id, table, len(classes))
    entries = await write_table(ObjectResultStore(context.store), table, plan)
    return WrittenCells(entries, matching.inherited, dropped)


async def keep_source(context: Context, key: str) -> None:
    row = context.upload.row
    if await context.store.head_object(key) != row.size_bytes:
        await context.store.copy_object(
            row.object_key, key, row.size_bytes, context.resources.copy_part_bytes
        )


@dataclass(frozen=True)
class Setting:
    frame: SlideFrame
    known: KnownClasses
    choices: Choices | None


async def setting_of(connection: Any, upload: Any) -> Setting:
    slide = None
    if upload.slide_id is not None:
        slide = (
            await connection.execute(
                select(slides.c.width, slides.c.height, slides.c.level_count, slides.c.mpp_x).where(
                    slides.c.id == upload.slide_id
                )
            )
        ).one_or_none()
    frame = (
        SlideFrame(slide.width, slide.height, slide.level_count, slide.mpp_x)
        if slide is not None
        else SlideFrame()
    )
    names = {
        row.id: row.name
        for row in await connection.execute(
            select(project_classes.c.id, project_classes.c.name).where(
                project_classes.c.project_id == upload.project_id
            )
        )
    }
    renames = {
        row.source_name: names[row.class_id]
        for row in await connection.execute(
            select(class_mappings.c.source_name, class_mappings.c.class_id).where(
                class_mappings.c.project_id == upload.project_id
            )
        )
        if row.class_id in names
    }
    known = KnownClasses(
        frozenset(key for name in names.values() if (key := class_key(name)) is not None), renames
    )
    return Setting(frame, known, choices_of(upload.import_choices, names, renames))


def choices_of(
    stored: Any, names: Mapping[uuid.UUID, str], renames: Mapping[str, str]
) -> Choices | None:
    if not isinstance(stored, dict):
        return Choices(renames=renames) if renames else None
    picked = cast("dict[str, Any]", stored)
    unclassified = picked.get("unclassified_class_id")
    score = picked.get("score_default")
    return Choices(
        score_default=ScoreDefault(score) if score else None,
        unclassified=names.get(uuid.UUID(unclassified)) if unclassified else None,
        renames=renames,
    )


async def ask_for_choices(context: Context, problems: list[dict[str, Any]], readable: int) -> None:
    async with context.step.transaction() as connection:
        await connection.execute(
            update(uploads)
            .where(uploads.c.id == context.upload.id)
            .values(import_problems={"readable": readable, "problems": problems})
        )
    shutil.rmtree(context.folder, ignore_errors=True)


async def check_heatmap(context: Context, path: Path, setting: Setting) -> Mapping[str, Any]:
    if context.upload.row.import_choices is not None:
        raise StepFailedError(ImportFailure.HEATMAP_NOT_STORED)
    shape = await asyncio.to_thread(raster_shape, path)
    await ask_for_choices(context, heatmap_problems(shape, setting.frame), 1)
    return {"needs_choices": True, "notices": []}


async def import_step(context: Context) -> Mapping[str, Any]:
    upload = context.upload.row
    if upload.result_set_id is not None:
        return {"result_set_id": str(upload.result_set_id), "notices": []}
    async with context.step.transaction() as connection:
        setting = await setting_of(connection, upload)
    path = await fetch(context)
    if upload.result_format == ResultFormat.HEATMAP:
        return await check_heatmap(context, path, setting)
    parsed, tally = await asyncio.to_thread(
        read_checked, path, upload.result_format, setting.frame, setting.choices
    )
    objects_to_import(parsed)
    if tally.all_outside:
        raise StepFailedError(ImportFailure.OUTSIDE_SLIDE)
    if upload.import_choices is None:
        problems = problems_of(tally, setting.known, parsed.declared_classes)
        if problems:
            await ask_for_choices(context, problems, tally.readable)
            return {"needs_choices": True, "notices": []}
    if setting.choices is not None:
        parsed.declared_classes = [
            setting.choices.renamed(name) or name for name in parsed.declared_classes
        ]
    classes = class_list(parsed)
    set_id = result_set_id_for(upload.id)
    async with context.step.transaction() as connection:
        locked = await locked_result_upload(connection, upload.id)
        if locked is None or locked.slide_id is None:
            raise StepFailedError(ImportFailure.SLIDE_MISSING)
        slide = await import_target(connection, locked.slide_id)
        if slide is None:
            raise StepFailedError(ImportFailure.SLIDE_MISSING)
        rows, regions = await rows_of(connection, locked, slide.id, parsed.shapes, classes)
        written = await write_imported_cells(
            context, connection, slide, set_id, parsed.cells, regions, classes
        )
        await keep_source(context, source_key(locked.tenant_id, slide.id, set_id, locked.file_name))
        draft = draft_of(parsed, classes, locked.file_name)
        await store_result_set(
            connection, locked, slide, set_id, draft, rows, context.step.job_id, written.entries
        )
    notices = [
        *([ImportNotice.PROBABILITIES_DROPPED.value] if written.probabilities_dropped else []),
        *([ImportNotice.OBJECTS_SKIPPED.value] if parsed.skipped else []),
    ]
    await context.store.delete_object(upload.object_key)
    shutil.rmtree(context.folder, ignore_errors=True)
    return {
        "result_set_id": str(set_id),
        "regions": sum(1 for row in rows if row.kind is ResultObjectKind.REGION),
        "zones": sum(1 for row in rows if row.kind is ResultObjectKind.ZONE),
        "cells": len(parsed.cells),
        "cells_inherited": written.inherited,
        "chunks": len(written.entries),
        "skipped": parsed.skipped,
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
