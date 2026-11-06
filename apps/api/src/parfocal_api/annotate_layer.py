import json
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Query, Response
from pydantic import BaseModel, model_validator
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
    add,
    author_of,
    check_classes,
    checked,
    code_of,
    record_versions,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.numbering import reserve
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.realtime import Realtime, RealtimeClient, RoomEvent
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
    result_objects,
)
from parfocal_api.task_kinds import annotate_only
from parfocal_common.object_ids import ObjectId

CHANGED_EVENT = "layer.object-changed"
SOURCE_INDEX = ["task_id", "slide_id", "kind", "source_number"]
SOURCE_WHERE = text("source_number IS NOT NULL")


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
    draft: AiObjectEdit,
) -> Any:
    if draft.geometry is not None:
        return await outline(connection, kind, draft.geometry)
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
    found = ai_object(object_id)
    if found.split:
        raise NotAnAiObjectError("Only whole AI objects are copied into the layer")
    if row.result_set_id is None:
        raise NoAiResultsError
    await check_exists(connection, row, found)
    kind = KINDS[found.letter]
    existing = await copy_of(connection, row, kind, found.number)
    if existing is not None:
        raise LayerObjectChangedError(existing)
    if draft.class_id is not None:
        await check_classes(connection, row.project_id, {draft.class_id})
    geometry = await ai_shape(connection, row, kind, found, draft)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    number = await reserve(connection, tenant_id, slide_id, LETTERS[kind], 1)
    made = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=tenant_id,
            project_id=row.project_id,
            slide_id=slide_id,
            task_id=task_id,
            kind=kind,
            number=number,
            geometry=geometry,
            class_id=draft.class_id,
            origin=AnnotationOrigin.AI_EDITED,
            source_number=found.number,
            created_by_user_id=author_of(principal),
            deleted_at=func.now() if draft.deleted else None,
        )
        .on_conflict_do_nothing(index_elements=SOURCE_INDEX, index_where=SOURCE_WHERE)
        .returning(annotations.c.id)
    )
    if made is None:
        raced = await copy_of(connection, row, kind, found.number)
        assert raced is not None
        raise LayerObjectChangedError(raced)
    change = AnnotationChange.DELETED if draft.deleted else AnnotationChange.EDITED
    await record_versions(connection, [made], change, principal)
    announce(background, live, row, made)
    logged_as = LayerChange.DELETED if draft.deleted else LayerChange.EDITED
    await logged(connection, principal, row, found.text(ascii=True), logged_as, reason)
    return await layer_object(connection, task_id, slide_id, made)


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
    gone = await save(
        connection,
        principal,
        row,
        annotation_id,
        version,
        {"deleted_at": func.now()},
        AnnotationChange.DELETED,
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
            annotation_versions.c.changed_by_user_id,
            annotation_versions.c.changed_at,
        )
        .where(annotation_versions.c.annotation_id == annotation_id)
        .order_by(annotation_versions.c.version)
    )
    return [
        AnnotationVersion(
            version=item.version,
            change=AnnotationChange(item.change),
            geometry=json.loads(item.geojson),
            class_id=item.class_id,
            changed_by_user_id=item.changed_by_user_id,
            changed_at=item.changed_at,
        )
        for item in rows
    ]
