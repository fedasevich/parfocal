import json
import uuid
from collections.abc import Sequence
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotate_sign_off import LayerChange, log_layer_change, owner_change_allowed
from parfocal_api.annotations import (
    LETTERS,
    AnnotationDraft,
    AnnotationEdit,
    AnnotationVersion,
    Geometry,
    MultiPolygonGeometry,
    PolygonGeometry,
    add,
    author_of,
    check_classes,
    checked,
    code_of,
    record_versions,
    words_for,
)
from parfocal_api.audit import AuditAction, AuditTarget
from parfocal_api.blinding import require_ai_shown
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.numbering import reserve
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.realtime import Realtime, RealtimeClient, RoomEvent
from parfocal_api.review_order import (
    CheckState,
    ResultFilesMissingError,
    ResultFilesUnreadableError,
    Results,
    check_states,
)
from parfocal_api.reviewed_layer import (
    KINDS,
    NotAnAiObjectError,
    ai_object,
    assigned_slide,
    check_exists,
    outline,
    task_slide,
)
from parfocal_api.room_access import RoomKind, room_name
from parfocal_api.tables import (
    AnnotationChange,
    AnnotationKind,
    AnnotationOrigin,
    annotation_versions,
    annotations,
    audit_events,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
)
from parfocal_api.task_kinds import annotate_only
from parfocal_common.cell_chunks import ChunkError
from parfocal_common.chunk_store import Cell, read_chunk
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import MissingObjectError, ResultStore

CHANGED_EVENT = "layer.object-changed"
SOURCE_INDEX = ["task_id", "slide_id", "kind", "source_number"]
SOURCE_WHERE = text("source_number IS NOT NULL")
AI_PAGE = 1000
MAX_AI_PAGE = 5000
TOP_SCORE = 255


class AiObjectEdit(BaseModel):
    geometry: Geometry | None = None
    class_id: uuid.UUID | None = None
    deleted: bool = False

    @model_validator(mode="after")
    def changes_something(self) -> AiObjectEdit:
        if self.geometry is not None:
            checked(self.geometry)
        if not self.deleted and self.class_id is None and self.geometry is None:
            raise ValueError("Retype, reshape or delete the object")
        return self


class AiObjectConfirm(BaseModel):
    geometry: Geometry | None = None

    @model_validator(mode="after")
    def valid_shape(self) -> AiObjectConfirm:
        if self.geometry is not None:
            checked(self.geometry)
        return self


class LayerObject(BaseModel):
    id: uuid.UUID
    slide_id: uuid.UUID
    kind: AnnotationKind
    number: int
    code: str
    origin: AnnotationOrigin
    source: str | None
    geometry: dict[str, Any]
    class_id: uuid.UUID | None
    text: str | None
    version: int
    created_by_user_id: uuid.UUID | None
    changed_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class SharedLayer(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    result_set_id: uuid.UUID | None
    objects: list[LayerObject]


type AiOutline = Annotated[PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")]


class SharedAiObject(BaseModel):
    object: str
    kind: Literal["region", "cell"]
    number: int
    class_id: uuid.UUID | None
    score: float | None
    geometry: AiOutline
    check: CheckState


class SharedAiObjects(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    result_set_id: uuid.UUID | None
    result_name: str | None
    total: int
    offset: int
    objects: list[SharedAiObject]


class LayerObjectChangedError(ConflictError):
    code = "annotation-changed"
    title = "This object changed since you loaded it"

    def __init__(self, current: LayerObject) -> None:
        deleted = " and deleted" if current.deleted_at else ""
        super().__init__(f"It is at version {current.version}{deleted}")
        self.current = current.model_dump(mode="json")


class CellShapeNeededError(BadRequestError):
    code = "cell-shape-needed"
    title = "Send the cell's outline when you change an AI cell"


class NotConfirmedError(ConflictError):
    code = "not-confirmed"
    title = "This AI object is not confirmed"


class NoAiResultsError(BadRequestError):
    code = "no-ai-results"
    title = "This task slide has no AI results"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/shared-layer", tags=["review-tasks"]
)

LAST_CHANGE = (
    select(annotation_versions.c.changed_by_user_id)
    .where(annotation_versions.c.annotation_id == annotations.c.id)
    .order_by(annotation_versions.c.version.desc())
    .limit(1)
    .scalar_subquery()
)

COLUMNS = (
    annotations.c.id,
    annotations.c.slide_id,
    annotations.c.kind,
    annotations.c.number,
    annotations.c.origin,
    annotations.c.source_number,
    func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
    annotations.c.class_id,
    annotations.c.text,
    annotations.c.version,
    annotations.c.created_by_user_id,
    LAST_CHANGE.label("changed_by_user_id"),
    annotations.c.created_at,
    annotations.c.updated_at,
    annotations.c.deleted_at,
)


def object_of(row: Any) -> LayerObject:
    kind = AnnotationKind(row.kind)
    source = (
        None
        if row.source_number is None
        else ObjectId(LETTERS[kind], row.source_number).text(ascii=True)
    )
    return LayerObject(
        id=row.id,
        slide_id=row.slide_id,
        kind=kind,
        number=row.number,
        code=code_of(kind, row.number),
        origin=AnnotationOrigin(row.origin),
        source=source,
        geometry=json.loads(row.geojson),
        class_id=row.class_id,
        text=row.text,
        version=row.version,
        created_by_user_id=row.created_by_user_id,
        changed_by_user_id=row.changed_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


def in_layer(task_id: uuid.UUID, slide_id: uuid.UUID) -> list[Any]:
    return [annotations.c.task_id == task_id, annotations.c.slide_id == slide_id]


async def layer_object(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, annotation_id: uuid.UUID
) -> LayerObject:
    row = (
        await connection.execute(
            select(*COLUMNS).where(*in_layer(task_id, slide_id), annotations.c.id == annotation_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Object not found")
    return object_of(row)


async def readable_layer(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    row = await task_slide(connection, principal, task_id, slide_id)
    annotate_only(row.kind)
    return row


async def editable_layer(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    reason: str | None = None,
) -> Any:
    row = await readable_layer(connection, principal, task_id, slide_id)
    if await owner_change_allowed(connection, principal, row, reason):
        return row
    return await assigned_slide(connection, principal, task_id, slide_id, review=False)


async def logged(
    connection: AsyncConnection,
    principal: Principal,
    row: Any,
    code: str,
    change: LayerChange,
    reason: str | None,
) -> None:
    if row.slide_signed_off_at is not None and reason is not None:
        await log_layer_change(connection, principal, row, code, change, reason)


async def imported_from(connection: AsyncConnection, annotation_id: uuid.UUID) -> str | None:
    details = await connection.scalar(
        select(audit_events.c.details)
        .where(
            audit_events.c.target_type == AuditTarget.ANNOTATION,
            audit_events.c.target_id == annotation_id,
            audit_events.c.action == AuditAction.ANNOTATION_IMPORTED,
        )
        .order_by(audit_events.c.seq)
        .limit(1)
    )
    name = None if details is None else json.loads(details).get("file_name")
    return name if isinstance(name, str) else None


def announce(
    background: BackgroundTasks, live: Realtime, row: Any, annotation_id: uuid.UUID
) -> None:
    event = RoomEvent(
        kind=CHANGED_EVENT,
        ids={"task": row.task_id, "slide": row.slide_id, "annotation": annotation_id},
    )
    background.add_task(live.publish, row.tenant_id, [room_name(RoomKind.TASK, row.task_id)], event)


@router.get("", operation_id="getSharedLayer", **require(Permission.SEE_SLIDES, emergency=True))
async def get_shared_layer(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SharedLayer:
    row = await readable_layer(connection, principal, task_id, slide_id)
    rows = await connection.execute(
        select(*COLUMNS)
        .where(
            *in_layer(task_id, slide_id),
            annotations.c.deleted_at.is_(None)
            | (annotations.c.origin == AnnotationOrigin.AI_EDITED),
        )
        .order_by(annotations.c.kind, annotations.c.number)
    )
    return SharedLayer(
        task_id=task_id,
        slide_id=slide_id,
        result_set_id=row.result_set_id,
        objects=[object_of(item) for item in rows],
    )


@router.post(
    "/objects",
    operation_id="createSharedObject",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_shared_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    draft: AnnotationDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerObject:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    slide = SimpleNamespace(id=slide_id, project_id=row.project_id)
    (made,) = await add(connection, principal, slide, [draft], task_id=task_id)
    announce(background, live, row, made.id)
    result = await layer_object(connection, task_id, slide_id, made.id)
    await logged(connection, principal, row, result.code, LayerChange.ADDED, reason)
    return result


async def ai_shape(
    connection: AsyncConnection,
    row: Any,
    kind: AnnotationKind,
    found: ObjectId,
    geometry: Geometry | None,
) -> Any:
    if geometry is not None:
        return await outline(connection, kind, geometry)
    if kind is AnnotationKind.CELL:
        raise CellShapeNeededError
    return (
        select(result_objects.c.geometry)
        .where(
            result_objects.c.result_set_id == row.result_set_id,
            result_objects.c.kind == "region",
            result_objects.c.number == found.number,
        )
        .scalar_subquery()
    )


async def copy_of(
    connection: AsyncConnection, row: Any, kind: AnnotationKind, number: int
) -> LayerObject | None:
    found = (
        await connection.execute(
            select(*COLUMNS).where(
                *in_layer(row.task_id, row.slide_id),
                annotations.c.kind == kind,
                annotations.c.source_number == number,
            )
        )
    ).one_or_none()
    return None if found is None else object_of(found)


def undone(copy: LayerObject) -> bool:
    return copy.origin is AnnotationOrigin.AI_CONFIRMED and copy.deleted_at is not None


async def source_of(
    connection: AsyncConnection, row: Any, object_id: str
) -> tuple[ObjectId, AnnotationKind]:
    found = ai_object(object_id)
    if found.split:
        raise NotAnAiObjectError("Only whole AI objects are copied into the layer")
    if row.result_set_id is None:
        raise NoAiResultsError
    await check_exists(connection, row, found)
    return found, KINDS[found.letter]


async def open_copy(
    connection: AsyncConnection, row: Any, kind: AnnotationKind, found: ObjectId
) -> LayerObject | None:
    existing = await copy_of(connection, row, kind, found.number)
    if existing is not None and not undone(existing):
        raise LayerObjectChangedError(existing)
    return existing


async def copy_in(
    connection: AsyncConnection,
    principal: Principal,
    row: Any,
    kind: AnnotationKind,
    found: ObjectId,
    values: dict[str, Any],
    change: AnnotationChange,
) -> uuid.UUID:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    number = await reserve(connection, tenant_id, row.slide_id, LETTERS[kind], 1)
    made = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=tenant_id,
            project_id=row.project_id,
            slide_id=row.slide_id,
            task_id=row.task_id,
            kind=kind,
            number=number,
            source_number=found.number,
            created_by_user_id=author_of(principal),
            **values,
        )
        .on_conflict_do_nothing(index_elements=SOURCE_INDEX, index_where=SOURCE_WHERE)
        .returning(annotations.c.id)
    )
    if made is None:
        raced = await copy_of(connection, row, kind, found.number)
        assert raced is not None
        raise LayerObjectChangedError(raced)
    await record_versions(connection, [made], change, principal)
    return made


async def revive(
    connection: AsyncConnection,
    principal: Principal,
    copy: LayerObject,
    values: dict[str, Any],
    change: AnnotationChange,
) -> uuid.UUID:
    revived = await connection.scalar(
        update(annotations)
        .where(
            annotations.c.id == copy.id,
            annotations.c.version == copy.version,
            annotations.c.origin == AnnotationOrigin.AI_CONFIRMED,
            annotations.c.deleted_at.is_not(None),
        )
        .values(version=annotations.c.version + 1, updated_at=func.now(), **values)
        .returning(annotations.c.id)
    )
    if revived is None:
        raise LayerObjectChangedError(copy)
    await record_versions(connection, [copy.id], change, principal)
    return copy.id


@router.put(
    "/ai/{object_id}",
    operation_id="changeAiObject",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def change_ai_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: AiObjectEdit,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerObject:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    found, kind = await source_of(connection, row, object_id)
    existing = await open_copy(connection, row, kind, found)
    if draft.class_id is not None:
        await check_classes(connection, row.project_id, {draft.class_id})
    values = {
        "geometry": await ai_shape(connection, row, kind, found, draft.geometry),
        "class_id": draft.class_id,
        "origin": AnnotationOrigin.AI_EDITED,
        "deleted_at": func.now() if draft.deleted else None,
    }
    change = AnnotationChange.DELETED if draft.deleted else AnnotationChange.EDITED
    made = (
        await copy_in(connection, principal, row, kind, found, values, change)
        if existing is None
        else await revive(connection, principal, existing, values, change)
    )
    announce(background, live, row, made)
    logged_as = LayerChange.DELETED if draft.deleted else LayerChange.EDITED
    await logged(connection, principal, row, found.text(ascii=True), logged_as, reason)
    return await layer_object(connection, task_id, slide_id, made)


@router.post(
    "/ai/{object_id}/confirm",
    operation_id="confirmAiObject",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def confirm_ai_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: AiObjectConfirm,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerObject:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    found, kind = await source_of(connection, row, object_id)
    existing = await open_copy(connection, row, kind, found)
    values = {
        "geometry": await ai_shape(
            connection,
            row,
            kind,
            found,
            draft.geometry if kind is AnnotationKind.CELL else None,
        ),
        "class_id": None,
        "origin": AnnotationOrigin.AI_CONFIRMED,
        "deleted_at": None,
    }
    made = (
        await copy_in(connection, principal, row, kind, found, values, AnnotationChange.CREATED)
        if existing is None
        else await revive(connection, principal, existing, values, AnnotationChange.RESTORED)
    )
    announce(background, live, row, made)
    await logged(connection, principal, row, found.text(ascii=True), LayerChange.EDITED, reason)
    return await layer_object(connection, task_id, slide_id, made)


@router.delete(
    "/ai/{object_id}/confirm",
    operation_id="undoAiConfirm",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def undo_ai_confirm(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    version: Annotated[int, Query(ge=1)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> Response:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    found, kind = await source_of(connection, row, object_id)
    existing = await copy_of(connection, row, kind, found.number)
    if existing is None or existing.origin is not AnnotationOrigin.AI_CONFIRMED or undone(existing):
        raise NotConfirmedError
    await save(
        connection,
        principal,
        row,
        existing.id,
        version,
        {"deleted_at": func.now()},
        AnnotationChange.DELETED,
    )
    announce(background, live, row, existing.id)
    await logged(connection, principal, row, found.text(ascii=True), LayerChange.EDITED, reason)
    return Response(status_code=204)


async def save(
    connection: AsyncConnection,
    principal: Principal,
    row: Any,
    annotation_id: uuid.UUID,
    version: int,
    values: dict[str, Any],
    change: AnnotationChange,
) -> LayerObject:
    current = await layer_object(connection, row.task_id, row.slide_id, annotation_id)
    changed = await connection.scalar(
        update(annotations)
        .where(
            *in_layer(row.task_id, row.slide_id),
            annotations.c.id == annotation_id,
            annotations.c.version == version,
            annotations.c.deleted_at.is_(None),
        )
        .values(version=annotations.c.version + 1, updated_at=func.now(), **values)
        .returning(annotations.c.id)
    )
    if changed is None:
        raise LayerObjectChangedError(current)
    await record_versions(connection, [annotation_id], change, principal)
    return await layer_object(connection, row.task_id, row.slide_id, annotation_id)


@router.patch(
    "/objects/{annotation_id}",
    operation_id="changeSharedObject",
    **require(Permission.REVIEW, write=True),
)
async def change_shared_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    edit: AnnotationEdit,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerObject:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    current = await layer_object(connection, task_id, slide_id, annotation_id)
    values: dict[str, Any] = {}
    if edit.geometry is not None:
        values["geometry"] = await outline(connection, current.kind, edit.geometry)
    if "class_id" in edit.model_fields_set:
        if edit.class_id is not None:
            await check_classes(connection, row.project_id, {edit.class_id})
        values["class_id"] = edit.class_id
    if "text" in edit.model_fields_set:
        values["text"] = words_for(current.kind, edit.text)
    if current.origin is AnnotationOrigin.AI_CONFIRMED:
        values["origin"] = AnnotationOrigin.AI_EDITED
    saved = await save(
        connection, principal, row, annotation_id, edit.version, values, AnnotationChange.EDITED
    )
    announce(background, live, row, annotation_id)
    await logged(connection, principal, row, saved.code, LayerChange.EDITED, reason)
    return saved


@router.delete(
    "/objects/{annotation_id}",
    operation_id="deleteSharedObject",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def delete_shared_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    version: Annotated[int, Query(ge=1)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> Response:
    row = await editable_layer(connection, principal, task_id, slide_id, reason)
    current = await layer_object(connection, task_id, slide_id, annotation_id)
    values: dict[str, Any] = {"deleted_at": func.now()}
    if current.origin is AnnotationOrigin.AI_CONFIRMED:
        values["origin"] = AnnotationOrigin.AI_EDITED
    gone = await save(
        connection, principal, row, annotation_id, version, values, AnnotationChange.DELETED
    )
    announce(background, live, row, annotation_id)
    await logged(connection, principal, row, gone.code, LayerChange.DELETED, reason)
    return Response(status_code=204)


@router.get(
    "/objects/{annotation_id}/history",
    operation_id="listSharedObjectHistory",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_shared_object_history(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[AnnotationVersion]:
    await readable_layer(connection, principal, task_id, slide_id)
    await layer_object(connection, task_id, slide_id, annotation_id)
    rows = await connection.execute(
        select(
            annotation_versions.c.version,
            annotation_versions.c.change,
            func.ST_AsGeoJSON(annotation_versions.c.geometry).label("geojson"),
            annotation_versions.c.class_id,
            annotation_versions.c.text,
            annotation_versions.c.changed_by_user_id,
            annotation_versions.c.changed_at,
        )
        .where(annotation_versions.c.annotation_id == annotation_id)
        .order_by(annotation_versions.c.version)
    )
    file_name = await imported_from(connection, annotation_id)
    return [
        AnnotationVersion(
            version=item.version,
            change=AnnotationChange(item.change),
            geometry=json.loads(item.geojson),
            class_id=item.class_id,
            text=item.text,
            changed_by_user_id=item.changed_by_user_id,
            changed_at=item.changed_at,
            file_name=file_name if item.change == AnnotationChange.CREATED else None,
        )
        for item in rows
    ]


def fraction(score: int | None) -> float | None:
    return None if score is None else score / TOP_SCORE


async def class_ids(connection: AsyncConnection, set_id: uuid.UUID) -> dict[int, uuid.UUID]:
    rows = await connection.execute(
        select(result_set_classes.c.position, result_set_classes.c.class_id).where(
            result_set_classes.c.result_set_id == set_id,
            result_set_classes.c.class_id.is_not(None),
        )
    )
    return {row.position: row.class_id for row in rows}


async def ai_regions(
    connection: AsyncConnection, set_id: uuid.UUID, offset: int, limit: int
) -> list[Any]:
    rows = await connection.execute(
        select(
            result_objects.c.number,
            result_objects.c.class_index,
            result_objects.c.score,
            func.ST_AsGeoJSON(result_objects.c.geometry).label("geojson"),
        )
        .where(result_objects.c.result_set_id == set_id, result_objects.c.kind == "region")
        .order_by(result_objects.c.number)
        .offset(offset)
        .limit(limit)
    )
    return list(rows)


async def stored_cells(store: ResultStore, object_key: str) -> list[Cell]:
    try:
        return await read_chunk(store, object_key)
    except MissingObjectError as error:
        raise ResultFilesMissingError from error
    except ChunkError as error:
        raise ResultFilesUnreadableError from error


async def ai_cells(
    connection: AsyncConnection, store: ResultStore, set_id: uuid.UUID, offset: int, limit: int
) -> list[Cell]:
    chunks = await connection.execute(
        select(result_chunks.c.object_key, result_chunks.c.cell_count)
        .where(result_chunks.c.result_set_id == set_id)
        .order_by(result_chunks.c.chunk)
    )
    found: list[Cell] = []
    skip = offset
    for chunk in chunks:
        if len(found) == limit:
            break
        if skip >= chunk.cell_count:
            skip -= chunk.cell_count
            continue
        cells = await stored_cells(store, chunk.object_key)
        found.extend(cells[skip : skip + limit - len(found)])
        skip = 0
    return found


def cell_outline(ring: Sequence[float]) -> PolygonGeometry:
    points = [(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
    return PolygonGeometry(type="Polygon", coordinates=[[*points, points[0]]])


async def ai_counts(connection: AsyncConnection, set_id: uuid.UUID) -> tuple[int, int]:
    regions = await connection.scalar(
        select(func.count()).where(
            result_objects.c.result_set_id == set_id, result_objects.c.kind == "region"
        )
    )
    cells = await connection.scalar(
        select(func.coalesce(func.sum(result_chunks.c.cell_count), 0)).where(
            result_chunks.c.result_set_id == set_id
        )
    )
    return int(regions or 0), int(cells or 0)


@router.get(
    "/ai",
    operation_id="listSharedAiObjects",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_shared_ai_objects(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_AI_PAGE)] = AI_PAGE,
) -> SharedAiObjects:
    row = await readable_layer(connection, principal, task_id, slide_id)
    set_id = row.result_set_id
    if set_id is None:
        return SharedAiObjects(
            task_id=task_id,
            slide_id=slide_id,
            result_set_id=None,
            result_name=None,
            total=0,
            offset=offset,
            objects=[],
        )
    await require_ai_shown(connection, principal, row.project_id, slide_id)
    name = await connection.scalar(select(result_sets.c.name).where(result_sets.c.id == set_id))
    region_total, cell_total = await ai_counts(connection, set_id)
    classes = await class_ids(connection, set_id)
    states = await check_states(connection, task_id, slide_id)

    def check(letter: Letter, number: int) -> CheckState:
        return states.get((slide_id, letter, number), CheckState.UNCHECKED)

    objects = [
        SharedAiObject(
            object=ObjectId(Letter.REGION, item.number).text(ascii=True),
            kind="region",
            number=item.number,
            class_id=None if item.class_index is None else classes.get(item.class_index),
            score=fraction(item.score),
            geometry=json.loads(item.geojson),
            check=check(Letter.REGION, item.number),
        )
        for item in await ai_regions(connection, set_id, offset, limit)
    ]
    if len(objects) < limit:
        cells = await ai_cells(
            connection, results, set_id, max(offset - region_total, 0), limit - len(objects)
        )
        objects.extend(
            SharedAiObject(
                object=ObjectId(Letter.CELL, cell.number).text(ascii=True),
                kind="cell",
                number=cell.number,
                class_id=classes.get(cell.class_index),
                score=fraction(cell.score),
                geometry=cell_outline(cell.ring),
                check=check(Letter.CELL, cell.number),
            )
            for cell in cells
        )
    return SharedAiObjects(
        task_id=task_id,
        slide_id=slide_id,
        result_set_id=set_id,
        result_name=name,
        total=region_total + cell_total,
        offset=offset,
        objects=objects,
    )
