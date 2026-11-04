import json
import uuid
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import LETTERS as ANNOTATION_LETTERS
from parfocal_api.annotations import PERSON_MADE_AI_KINDS
from parfocal_api.blinding import require_ai_shown
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import class_names
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.result_sets import set_row, slide_row
from parfocal_api.review_order import Results
from parfocal_api.reviewed_export import path_parts
from parfocal_api.tables import (
    AnnotationKind,
    ResultStatus,
    annotations,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
)
from parfocal_common import flatgeobuf
from parfocal_common.chunk_store import Cell, read_chunk
from parfocal_common.flatgeobuf import ColumnType
from parfocal_common.object_ids import Letter, ObjectId, ObjectPath
from parfocal_common.result_store import ResultStore

AI_LETTERS = {"region": Letter.REGION, "zone": Letter.ZONE}
COLUMNS = [
    ("id", ColumnType.STRING),
    ("kind", ColumnType.STRING),
    ("class", ColumnType.STRING),
    ("origin", ColumnType.STRING),
    ("score", ColumnType.INT),
    ("path", ColumnType.STRING),
]
MEDIA_TYPES = {
    "geojson": "application/geo+json",
    "flatgeobuf": "application/flatgeobuf",
    "parfocal": "application/json",
}
SUFFIXES = {"geojson": "geojson", "flatgeobuf": "fgb", "parfocal": "json"}


class ExportFormat(StrEnum):
    GEOJSON = "geojson"
    FLATGEOBUF = "flatgeobuf"
    PARFOCAL = "parfocal"


class RunNotReadyError(ConflictError):
    code = "run-not-ready"
    title = "Export a run once its import has finished"


@dataclass(frozen=True)
class Feature:
    kind: str
    object_id: ObjectId
    geometry: dict[str, Any]
    class_name: str | None
    origin: str
    score: int | None


@dataclass(frozen=True)
class Plan:
    where: tuple[str, str | None, str]
    model: str
    count: int
    rows: list[Feature]
    chunk_keys: list[str]
    cell_classes: dict[int, str]


router = APIRouter(prefix="/api/slides/{slide_id}/export", tags=["annotations"])


def path_of(where: tuple[str, str | None, str], object_id: ObjectId) -> str:
    return ObjectPath(where[0], where[1], where[2], object_id).text()


def properties_of(feature: Feature, where: tuple[str, str | None, str]) -> dict[str, Any]:
    details: dict[str, Any] = {
        "id": feature.object_id.text(ascii=True),
        "path": path_of(where, feature.object_id),
        "kind": feature.kind,
        "origin": feature.origin,
    }
    if feature.score is not None:
        details["score"] = feature.score
    return details


def geojson_feature(feature: Feature, where: tuple[str, str | None, str]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "id": feature.object_id.text(ascii=True),
        "geometry": feature.geometry,
        "properties": {
            "objectType": "cell" if feature.kind == "cell" else "annotation",
            **({"classification": {"name": feature.class_name}} if feature.class_name else {}),
            "parfocal": properties_of(feature, where),
        },
    }


def parfocal_object(feature: Feature, where: tuple[str, str | None, str]) -> dict[str, Any]:
    return {
        "kind": feature.kind,
        "source_id": feature.object_id.text(ascii=True),
        **({"class": feature.class_name} if feature.class_name else {}),
        "geometry": feature.geometry,
        "properties": {"parfocal": properties_of(feature, where)},
    }


def flatgeobuf_feature(feature: Feature, where: tuple[str, str | None, str]) -> bytes:
    values = {
        "id": feature.object_id.text(ascii=True),
        "kind": feature.kind,
        "class": feature.class_name,
        "origin": feature.origin,
        "score": feature.score,
        "path": path_of(where, feature.object_id),
    }
    return flatgeobuf.feature(feature.geometry, COLUMNS, values)


def cell_feature(cell: Cell, classes: dict[int, str]) -> Feature:
    points = [[cell.ring[i], cell.ring[i + 1]] for i in range(0, len(cell.ring), 2)]
    return Feature(
        "cell",
        ObjectId(Letter.CELL, cell.number, region=cell.region or None),
        {"type": "Polygon", "coordinates": [[*points, points[0]]]},
        classes.get(cell.class_index),
        "ai",
        cell.score,
    )


def encoded(features: Iterable[Feature], plan: Plan, format: ExportFormat, first: bool) -> bytes:
    if format is ExportFormat.FLATGEOBUF:
        return b"".join(flatgeobuf_feature(feature, plan.where) for feature in features)
    shape = geojson_feature if format is ExportFormat.GEOJSON else parfocal_object
    parts = [
        json.dumps(shape(feature, plan.where), separators=(",", ":"), ensure_ascii=False)
        for feature in features
    ]
    if not parts:
        return b""
    return (("" if first else ",") + ",".join(parts)).encode()


def opening(plan: Plan, format: ExportFormat) -> bytes:
    match format:
        case ExportFormat.FLATGEOBUF:
            return flatgeobuf.header(plan.where[2][:255], COLUMNS, plan.count)
        case ExportFormat.GEOJSON:
            return b'{"type":"FeatureCollection","features":['
        case ExportFormat.PARFOCAL:
            head = {
                "format": "parfocal-results",
                "version": 1,
                "slide": {"file_name": plan.where[2][:255]},
                "model": {"name": plan.model[:120]},
            }
            return json.dumps(head, ensure_ascii=False)[:-1].encode() + b',"objects":['


async def body(plan: Plan, format: ExportFormat, store: ResultStore) -> AsyncIterator[bytes]:
    yield opening(plan, format)
    written = bool(plan.rows)
    yield encoded(plan.rows, plan, format, first=True)
    for key in plan.chunk_keys:
        cells = await read_chunk(store, key)
        yield encoded(
            (cell_feature(cell, plan.cell_classes) for cell in cells), plan, format, not written
        )
        written = written or bool(cells)
    if format is not ExportFormat.FLATGEOBUF:
        yield b"]}"


async def annotation_rows(
    connection: AsyncConnection, slide_id: uuid.UUID, names: dict[uuid.UUID, str]
) -> list[Feature]:
    rows = await connection.execute(
        select(
            annotations.c.kind,
            annotations.c.number,
            annotations.c.class_id,
            func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
        )
        .where(
            annotations.c.slide_id == slide_id,
            annotations.c.deleted_at.is_(None),
            annotations.c.task_id.is_(None),
        )
        .order_by(annotations.c.kind, annotations.c.number)
    )
    return [
        Feature(
            row.kind,
            ObjectId(
                ANNOTATION_LETTERS[AnnotationKind(row.kind)],
                row.number,
                person=AnnotationKind(row.kind) in PERSON_MADE_AI_KINDS,
            ),
            json.loads(row.geojson),
            names.get(row.class_id) if row.class_id else None,
            "human",
            None,
        )
        for row in rows
    ]


async def set_classes(connection: AsyncConnection, set_id: uuid.UUID) -> dict[int, str]:
    rows = await connection.execute(
        select(result_set_classes.c.position, result_set_classes.c.source_name).where(
            result_set_classes.c.result_set_id == set_id
        )
    )
    return {row.position: row.source_name for row in rows}


async def ai_rows(
    connection: AsyncConnection, set_id: uuid.UUID, classes: dict[int, str]
) -> list[Feature]:
    rows = await connection.execute(
        select(
            result_objects.c.kind,
            result_objects.c.number,
            result_objects.c.class_index,
            result_objects.c.score,
            func.ST_AsGeoJSON(result_objects.c.geometry).label("geojson"),
        )
        .where(result_objects.c.result_set_id == set_id)
        .order_by(result_objects.c.kind, result_objects.c.number)
    )
    return [
        Feature(
            row.kind,
            ObjectId(AI_LETTERS[row.kind], row.number),
            json.loads(row.geojson),
            None if row.class_index is None else classes.get(row.class_index),
            "ai",
            row.score,
        )
        for row in rows
    ]


async def chunk_rows(connection: AsyncConnection, set_id: uuid.UUID) -> Sequence[Any]:
    return (
        await connection.execute(
            select(result_chunks.c.object_key, result_chunks.c.cell_count)
            .where(result_chunks.c.result_set_id == set_id)
            .order_by(result_chunks.c.chunk)
        )
    ).all()


async def plan_of(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    slide_id: uuid.UUID,
    result_set_id: uuid.UUID | None,
) -> Plan:
    slide = await slide_row(connection, principal, slide_id)
    where = await path_parts(connection, slide_id)
    rows = await annotation_rows(
        connection, slide_id, await class_names(connection, slide.project_id)
    )
    if result_set_id is None:
        return Plan(where, "Annotations", len(rows), rows, [], {})
    found = await set_row(connection, principal, result_set_id)
    if found.slide_id != slide_id:
        raise NotFoundError("Result set not found")
    if found.status != ResultStatus.READY:
        raise RunNotReadyError
    await require_ai_shown(connection, principal, found.project_id, slide_id)
    classes = await set_classes(connection, result_set_id)
    ai = await ai_rows(connection, result_set_id, classes)
    chunks = await chunk_rows(connection, result_set_id)
    name = await connection.scalar(
        select(result_sets.c.name).where(result_sets.c.id == result_set_id)
    )
    return Plan(
        where,
        str(name),
        len(ai) + sum(chunk.cell_count for chunk in chunks) + len(rows),
        [*ai, *rows],
        [chunk.object_key for chunk in chunks],
        classes,
    )


@router.get(
    "",
    operation_id="exportSlideObjects",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Every annotation on the slide and, when named, every object of a run",
            "content": {
                media: {"schema": {"type": "string", "format": "binary"}}
                for media in MEDIA_TYPES.values()
            },
        }
    },
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def export_slide_objects(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    format: ExportFormat = ExportFormat.GEOJSON,
    result_set_id: uuid.UUID | None = None,
) -> StreamingResponse:
    plan = await plan_of(connection, principal, slide_id, result_set_id)
    return StreamingResponse(
        body(plan, format, results),
        media_type=MEDIA_TYPES[format],
        headers={
            "Content-Disposition": f'attachment; filename="parfocal-export.{SUFFIXES[format]}"',
            "X-Content-Type-Options": "nosniff",
            "X-Object-Count": str(plan.count),
        },
    )
