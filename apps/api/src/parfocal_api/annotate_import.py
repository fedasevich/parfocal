import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Annotated, Any, cast

from fastapi import APIRouter, BackgroundTasks, Query
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotate_layer import COLUMNS as LAYER_COLUMNS
from parfocal_api.annotate_layer import (
    LayerObject,
    announce,
    editable_layer,
    in_layer,
    logged,
    object_of,
)
from parfocal_api.annotate_sign_off import LayerChange
from parfocal_api.annotations import MAX_BULK, SHAPES, AnnotationDraft, add
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record_many
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import class_names
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.realtime import RealtimeClient
from parfocal_api.tables import AnnotationKind, annotations

OWN_FORMATS = frozenset({"parfocal-annotations", "parfocal-results"})
CELL_TYPES = frozenset({"cell", "detection", "tile"})
DEFAULT_KINDS = {
    "Point": AnnotationKind.CELL,
    "LineString": AnnotationKind.MEASUREMENT,
    "Polygon": AnnotationKind.REGION,
    "MultiPolygon": AnnotationKind.REGION,
}


class LayerImport(BaseModel):
    file_name: Annotated[str, Field(min_length=1, max_length=255)]
    content: dict[str, Any] | list[Any]


class SkippedFeature(BaseModel):
    index: int
    reason: str


class LayerImportResult(BaseModel):
    file_name: str
    objects: list[LayerObject]
    skipped: list[SkippedFeature]
    unknown_classes: list[str]


class UnreadableImportError(BadRequestError):
    code = "unreadable-import"
    title = "This file is not GeoJSON or a Parfocal export"


class NothingToImportError(BadRequestError):
    code = "nothing-to-import"
    title = "The file holds no shapes this layer can take"


class ImportTooLargeError(BadRequestError):
    code = "import-too-large"
    title = f"Import at most {MAX_BULK} shapes at once"


@dataclass(frozen=True)
class Candidate:
    index: int
    kind: str | None
    object_type: str | None
    geometry: Any
    class_name: str | None
    words: str | None = None


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/shared-layer", tags=["review-tasks"]
)


def mapping(value: Any) -> dict[str, Any] | None:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else None


def items(value: Any) -> list[Any] | None:
    return cast("list[Any]", value) if isinstance(value, list) else None


def text_of(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def words_of(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def classification_of(properties: dict[str, Any]) -> str | None:
    classification = properties.get("classification")
    named = mapping(classification)
    if named is not None:
        return text_of(named.get("name"))
    return text_of(classification) or text_of(properties.get("class"))


def from_feature(index: int, value: Any) -> Candidate:
    feature = mapping(value)
    if feature is None:
        return Candidate(index, None, None, None, None)
    properties = mapping(feature.get("properties")) or {}
    own = mapping(properties.get("parfocal")) or {}
    return Candidate(
        index,
        text_of(own.get("kind")),
        text_of(properties.get("objectType")),
        feature.get("geometry"),
        classification_of(properties),
        words_of(own.get("text")),
    )


def from_object(index: int, value: Any) -> Candidate:
    item = mapping(value)
    if item is None:
        return Candidate(index, None, None, None, None)
    return Candidate(
        index,
        text_of(item.get("kind")),
        None,
        item.get("geometry"),
        text_of(item.get("class")),
        words_of(item.get("text")),
    )


def candidates(content: dict[str, Any] | list[Any]) -> list[Candidate]:
    if isinstance(content, list):
        return [from_feature(index, item) for index, item in enumerate(content)]
    objects = items(content.get("objects"))
    if content.get("format") in OWN_FORMATS and objects is not None:
        return [from_object(index, item) for index, item in enumerate(objects)]
    features = items(content.get("features"))
    if content.get("type") == "FeatureCollection" and features is not None:
        return [from_feature(index, item) for index, item in enumerate(features)]
    if content.get("type") == "Feature":
        return [from_feature(0, content)]
    raise UnreadableImportError


def kind_of(candidate: Candidate, geometry_type: str) -> AnnotationKind | None:
    if candidate.kind in AnnotationKind:
        chosen = AnnotationKind(candidate.kind)
        return chosen if geometry_type in SHAPES[chosen] else None
    if candidate.object_type in CELL_TYPES and geometry_type in SHAPES[AnnotationKind.CELL]:
        return AnnotationKind.CELL
    return DEFAULT_KINDS.get(geometry_type)


def pieces(geometry: dict[str, Any]) -> Iterator[dict[str, Any]]:
    points = items(geometry.get("coordinates"))
    if geometry.get("type") == "MultiPoint" and points is not None:
        for point in points:
            yield {"type": "Point", "coordinates": point}
    else:
        yield geometry


def drafts_of(
    found: list[Candidate], classes: dict[str, uuid.UUID]
) -> tuple[list[AnnotationDraft], list[SkippedFeature], list[str]]:
    drafts: list[AnnotationDraft] = []
    skipped: list[SkippedFeature] = []
    unknown: set[str] = set()
    for candidate in found:
        shape = mapping(candidate.geometry)
        if shape is None:
            skipped.append(SkippedFeature(index=candidate.index, reason="It has no geometry"))
            continue
        class_id = None
        if candidate.class_name is not None:
            class_id = classes.get(candidate.class_name.casefold())
            if class_id is None:
                unknown.add(candidate.class_name)
        for geometry in pieces(shape):
            kind = kind_of(candidate, str(geometry.get("type")))
            if kind is None:
                reason = f"A {geometry.get('type')} cannot go on the layer"
                skipped.append(SkippedFeature(index=candidate.index, reason=reason))
                continue
            try:
                draft: dict[str, Any] = {"kind": kind, "geometry": geometry, "class_id": class_id}
                if kind is AnnotationKind.TEXT:
                    draft["text"] = candidate.words
                drafts.append(AnnotationDraft.model_validate(draft))
            except ValidationError as error:
                reason = error.errors()[0]["msg"]
                skipped.append(SkippedFeature(index=candidate.index, reason=reason))
    return drafts, skipped, sorted(unknown)


async def project_classes(
    connection: AsyncConnection, project_id: uuid.UUID
) -> dict[str, uuid.UUID]:
    names = await class_names(connection, project_id)
    return {name.casefold(): class_id for class_id, name in names.items()}


@router.post(
    "/imports",
    operation_id="importSharedObjects",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def import_shared_objects(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    upload: LayerImport,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerImportResult:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    found = candidates(upload.content)
    if len(found) > MAX_BULK:
        raise ImportTooLargeError
    drafts, skipped, unknown = drafts_of(found, await project_classes(connection, row.project_id))
    if not drafts:
        raise NothingToImportError
    if len(drafts) > MAX_BULK:
        raise ImportTooLargeError
    slide = SimpleNamespace(id=slide_id, project_id=row.project_id)
    made = await add(connection, principal, slide, drafts, task_id=task_id)
    ids = [item.id for item in made]
    await record_many(
        connection,
        actor_of(principal),
        AuditAction.ANNOTATION_IMPORTED,
        AuditTarget.ANNOTATION,
        ids,
        tenant_id=row.tenant_id,
        details={"file_name": upload.file_name, "task_id": str(task_id), "slide_id": str(slide_id)},
    )
    for item in made:
        await announce(connection, background, live, row, item.id)
        await logged(connection, principal, row, item.code, LayerChange.ADDED, reason)
    rows = await connection.execute(
        select(*LAYER_COLUMNS).where(*in_layer(task_id, slide_id), annotations.c.id.in_(ids))
    )
    by_id = {item.id: object_of(item) for item in rows}
    return LayerImportResult(
        file_name=upload.file_name,
        objects=[by_id[annotation_id] for annotation_id in ids],
        skipped=skipped,
        unknown_classes=unknown,
    )
