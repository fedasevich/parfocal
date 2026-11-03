import json
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import COLUMNS as ANNOTATION_COLUMNS
from parfocal_api.annotations import (
    SHAPES,
    Annotation,
    AnnotationDraft,
    Geometry,
    InvalidShapeError,
    add,
    annotation_of,
    check_classes,
    check_shapes,
    checked,
)
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import (
    ai_hidden_on,
    require_judging_allowed,
    require_seeing_reviewer,
    user_of,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import require_slide_reading
from parfocal_api.projects import ProjectArchivedError
from parfocal_api.tables import (
    AnnotationKind,
    PrivacyMode,
    annotations,
    projects,
    result_objects,
    result_sets,
    review_assignments,
    review_edits,
    review_task_slides,
    review_tasks,
    slide_counters,
)
from parfocal_common.object_ids import (
    Letter,
    ObjectId,
    ObjectIdError,
    merge_keeper,
    parse,
    split_into,
)
from parfocal_common.object_lineage import Fate, Key, Retired, descendants, resolve

KINDS = {Letter.REGION: AnnotationKind.REGION, Letter.CELL: AnnotationKind.CELL}


class EditDraft(BaseModel):
    class_id: uuid.UUID | None = None
    geometry: Geometry | None = None
    deleted: bool = False

    @model_validator(mode="after")
    def changes_something(self) -> EditDraft:
        if self.geometry is not None:
            checked(self.geometry)
        if not self.deleted and self.class_id is None and self.geometry is None:
            raise ValueError("Retype, reshape or delete the object")
        return self


class SplitPart(BaseModel):
    geometry: Geometry
    class_id: uuid.UUID | None = None


class SplitDraft(BaseModel):
    parts: list[SplitPart] = Field(min_length=2, max_length=26)


class MergeDraft(BaseModel):
    objects: list[str] = Field(min_length=2, max_length=100)
    geometry: Geometry
    class_id: uuid.UUID | None = None


class ObjectResolution(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    reviewer_id: uuid.UUID
    object: str
    current: list[str]


class AddedDraft(BaseModel):
    kind: Literal[AnnotationKind.REGION, AnnotationKind.CELL]
    geometry: Geometry
    class_id: uuid.UUID | None = None


class ReviewEdit(BaseModel):
    object: str
    kind: AnnotationKind
    number: int
    split: str
    class_id: uuid.UUID | None
    geometry: dict[str, Any] | None
    deleted: bool
    retired: Retired | None
    merged_into: str | None
    updated_at: datetime


class LayerSummary(BaseModel):
    regions: int | None
    cells: int | None
    retyped: int
    reshaped: int
    deleted: int
    split: int
    merged: int
    added: int


class ReviewedLayer(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    result_set_id: uuid.UUID
    reviewer_id: uuid.UUID
    edits: list[ReviewEdit]
    added: list[Annotation]
    summary: LayerSummary


class NotAssignedError(ForbiddenError):
    code = "not-assigned"
    title = "Only the reviewer assigned to this slide changes their review of it"


class NotAnAiObjectError(BadRequestError):
    code = "not-an-ai-object"
    title = "Only AI regions and cells are edited in a review"


class NotARegionError(BadRequestError):
    code = "not-a-region"
    title = "Only regions are split or merged in a review"


class RetiredObjectError(ConflictError):
    code = "retired-object"
    title = "The object was split or merged and is kept only in the history"


class SplitPartError(ConflictError):
    code = "split-part"
    title = "A part of a split is undone by undoing the split"


class UnknownObjectError(NotFoundError):
    code = "unknown-object"
    title = "The result set has no such object"


class TaskSignedOffError(ConflictError):
    code = "task-signed-off"
    title = "The task is signed off. An owner can reopen it"


router = APIRouter(prefix="/api/review-tasks/{task_id}/slides/{slide_id}", tags=["review-tasks"])


async def task_slide(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    row = (
        await connection.execute(
            select(
                review_task_slides.c.task_id,
                review_task_slides.c.slide_id,
                review_task_slides.c.result_set_id,
                review_tasks.c.project_id,
                review_tasks.c.tenant_id,
                review_tasks.c.signed_off_at,
                review_tasks.c.decision_style,
                review_tasks.c.counts_as,
                projects.c.privacy_mode,
                projects.c.archived_at,
            )
            .join(review_tasks, review_tasks.c.id == review_task_slides.c.task_id)
            .join(projects, projects.c.id == review_tasks.c.project_id)
            .where(
                review_task_slides.c.task_id == task_id,
                review_task_slides.c.slide_id == slide_id,
                review_tasks.c.archived_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Task slide not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Task slide not found",
    )
    return row


async def assigned_slide(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    row = await task_slide(connection, principal, task_id, slide_id)
    assigned = select(review_assignments).where(
        review_assignments.c.task_id == task_id,
        review_assignments.c.slide_id == slide_id,
        review_assignments.c.user_id == user_of(principal),
        review_assignments.c.released_at.is_(None),
    )
    if not await connection.scalar(select(assigned.exists())):
        raise NotAssignedError
    if row.signed_off_at is not None:
        raise TaskSignedOffError
    if row.archived_at is not None:
        raise ProjectArchivedError
    return row


def ai_object(text: str) -> ObjectId:
    try:
        found = parse(text)
    except ObjectIdError as error:
        raise NotAnAiObjectError(str(error)) from error
    if found.letter not in KINDS or found.person:
        raise NotAnAiObjectError
    return ObjectId(found.letter, found.number, found.split)


def region(text: str) -> ObjectId:
    found = ai_object(text)
    if found.letter is not Letter.REGION:
        raise NotARegionError
    return found


def key_of(found: ObjectId) -> Key:
    return found.number, found.split


def text_of(letter: Letter, key: Key) -> str:
    return ObjectId(letter, *key).text(ascii=True)


async def fates_of(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    letter: Letter,
) -> dict[Key, Any]:
    rows = await connection.execute(
        select(
            review_edits.c.number,
            review_edits.c.split,
            review_edits.c.class_id,
            review_edits.c.deleted,
            review_edits.c.retired,
            review_edits.c.merged_into_number,
            review_edits.c.merged_into_split,
        ).where(*mine(task_id, slide_id, user_id), review_edits.c.kind == KINDS[letter])
    )
    return {(row.number, row.split): row for row in rows}


def lineage(rows: dict[Key, Any]) -> dict[Key, Fate]:
    return {
        key: Fate(
            deleted=row.deleted,
            retired=Retired(row.retired) if row.retired else None,
            merged_into=(
                (row.merged_into_number, row.merged_into_split)
                if row.merged_into_number is not None
                else None
            ),
        )
        for key, row in rows.items()
    }


async def require_known(
    connection: AsyncConnection, row: Any, rows: dict[Key, Any], found: ObjectId
) -> None:
    if found.split:
        if key_of(found) not in rows:
            raise UnknownObjectError(f"{found.text(ascii=True)} is not in this review")
        return
    await check_exists(connection, row, found)


async def require_live(
    connection: AsyncConnection,
    row: Any,
    rows: dict[Key, Any],
    found: ObjectId,
    *,
    deleted_too: bool = True,
) -> None:
    await require_known(connection, row, rows, found)
    fate = rows.get(key_of(found))
    if fate is None:
        return
    name = found.text(ascii=True)
    if fate.retired == Retired.SPLIT:
        raise RetiredObjectError(f"{name} was split")
    if fate.retired == Retired.MERGED:
        into = text_of(found.letter, (fate.merged_into_number, fate.merged_into_split))
        raise RetiredObjectError(f"{name} was merged into {into}")
    if fate.deleted and not deleted_too:
        raise RetiredObjectError(f"{name} is deleted")


async def check_exists(connection: AsyncConnection, row: Any, found: ObjectId) -> None:
    if found.letter is Letter.REGION:
        present = select(result_objects).where(
            result_objects.c.result_set_id == row.result_set_id,
            result_objects.c.kind == "region",
            result_objects.c.number == found.number,
        )
        exists = await connection.scalar(select(present.exists()))
    else:
        last = await connection.scalar(
            select(slide_counters.c.last).where(
                slide_counters.c.slide_id == row.slide_id,
                slide_counters.c.letter == Letter.CELL.value,
            )
        )
        exists = last is not None and found.number <= last
    if not exists:
        raise UnknownObjectError(f"{found.text(ascii=True)} is not in this result set")


def edit_of(row: Any) -> ReviewEdit:
    kind = AnnotationKind(row.kind)
    letter = Letter.REGION if kind is AnnotationKind.REGION else Letter.CELL
    merged_into = (
        text_of(letter, (row.merged_into_number, row.merged_into_split))
        if row.merged_into_number is not None
        else None
    )
    return ReviewEdit(
        object=ObjectId(letter, row.number, row.split).text(ascii=True),
        kind=kind,
        number=row.number,
        split=row.split,
        class_id=row.class_id,
        geometry=json.loads(row.geojson) if row.geojson else None,
        deleted=row.deleted,
        retired=Retired(row.retired) if row.retired else None,
        merged_into=merged_into,
        updated_at=row.updated_at,
    )


EDIT_COLUMNS = (
    review_edits.c.kind,
    review_edits.c.number,
    review_edits.c.split,
    review_edits.c.class_id,
    func.ST_AsGeoJSON(review_edits.c.geometry).label("geojson"),
    review_edits.c.deleted,
    review_edits.c.retired,
    review_edits.c.merged_into_number,
    review_edits.c.merged_into_split,
    review_edits.c.updated_at,
)

KEY_COLUMNS = [
    review_edits.c.task_id,
    review_edits.c.slide_id,
    review_edits.c.user_id,
    review_edits.c.kind,
    review_edits.c.number,
    review_edits.c.split,
]


def same(kind: AnnotationKind, key: Key) -> list[Any]:
    return [
        review_edits.c.kind == kind,
        review_edits.c.number == key[0],
        review_edits.c.split == key[1],
    ]


async def saved_edit(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    key: Key,
) -> ReviewEdit:
    saved = (
        await connection.execute(
            select(*EDIT_COLUMNS).where(*mine(task_id, slide_id, user_id), *same(kind, key))
        )
    ).one()
    return edit_of(saved)


async def outline(connection: AsyncConnection, kind: AnnotationKind, geometry: Geometry) -> Any:
    if geometry.type not in SHAPES[kind]:
        raise InvalidShapeError(f"A {kind} cannot be a {geometry.type}")
    shape = geometry.model_dump_json()
    await check_shapes(connection, [shape])
    return func.ST_SetSRID(func.ST_GeomFromGeoJSON(shape), 0)


def mine(task_id: uuid.UUID, slide_id: uuid.UUID, user_id: uuid.UUID | None) -> list[Any]:
    return [
        review_edits.c.task_id == task_id,
        review_edits.c.slide_id == slide_id,
        review_edits.c.user_id == user_id,
    ]


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Any,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        row.task_id,
        tenant_id=row.tenant_id,
        details={"slide_id": str(row.slide_id), **details},
    )


@router.put(
    "/edits/{object_id}",
    operation_id="saveReviewEdit",
    **require(Permission.REVIEW, write=True),
)
async def save_review_edit(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: EditDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ReviewEdit:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    user_id = user_of(principal)
    rows = await fates_of(connection, task_id, slide_id, user_id, found.letter)
    await require_live(connection, row, rows, found)
    kind = KINDS[found.letter]
    geometry = None if draft.geometry is None else await outline(connection, kind, draft.geometry)
    if draft.class_id is not None:
        await check_classes(connection, row.project_id, {draft.class_id})
    values: dict[str, Any] = {"class_id": draft.class_id, "deleted": draft.deleted}
    if geometry is not None or not found.split:
        values["geometry"] = geometry
    await connection.execute(
        upsert(review_edits)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=user_id,
            kind=kind,
            number=found.number,
            split=found.split,
            **values,
        )
        .on_conflict_do_update(
            index_elements=KEY_COLUMNS, set_={**values, "updated_at": func.now()}
        )
    )
    changes = [
        name
        for name, present in (
            ("retyped", draft.class_id is not None),
            ("reshaped", draft.geometry is not None),
            ("deleted", draft.deleted),
        )
        if present
    ]
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_EDITED,
        row,
        {"object": found.text(ascii=True), "changes": changes},
    )
    return await saved_edit(connection, task_id, slide_id, user_id, kind, key_of(found))


async def restore(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    keys: list[Key],
) -> None:
    for number, split in keys:
        where = [*mine(task_id, slide_id, user_id), *same(kind, (number, split))]
        if split:
            await connection.execute(
                update(review_edits)
                .where(*where)
                .values(retired=None, merged_into_number=None, merged_into_split=None)
            )
        else:
            await connection.execute(delete(review_edits).where(*where))


@router.delete(
    "/edits/{object_id}",
    operation_id="clearReviewEdit",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def clear_review_edit(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    user_id = user_of(principal)
    kind = KINDS[found.letter]
    rows = await fates_of(connection, task_id, slide_id, user_id, found.letter)
    key = key_of(found)
    fate = rows.get(key)
    if fate is None:
        return Response(status_code=204)
    if found.split and fate.retired is None:
        raise SplitPartError(f"Undo the split of {text_of(found.letter, (found.number, ''))}")
    fates = lineage(rows)
    gone = descendants(fates, key) if fate.retired == Retired.SPLIT else []
    if not found.split:
        gone.append(key)
    aliases = [
        alias
        for alias, other in fates.items()
        if other.merged_into is not None and other.merged_into in gone
    ]
    for number, split in gone:
        await connection.execute(
            delete(review_edits).where(
                *mine(task_id, slide_id, user_id), *same(kind, (number, split))
            )
        )
    await restore(
        connection,
        task_id,
        slide_id,
        user_id,
        kind,
        [alias for alias in aliases if alias not in gone] + ([key] if found.split else []),
    )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_RESTORED,
        row,
        {"object": found.text(ascii=True)},
    )
    return Response(status_code=204)


@router.post(
    "/edits/{object_id}/split",
    operation_id="splitReviewObject",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def split_review_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: SplitDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[ReviewEdit]:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = region(object_id)
    user_id = user_of(principal)
    rows = await fates_of(connection, task_id, slide_id, user_id, found.letter)
    await require_live(connection, row, rows, found, deleted_too=False)
    try:
        parts = split_into(found, len(draft.parts))
    except ObjectIdError as error:
        raise BadRequestError(str(error)) from error
    await check_classes(
        connection, row.project_id, {part.class_id for part in draft.parts if part.class_id}
    )
    kind = AnnotationKind.REGION
    parent = rows.get(key_of(found))
    inherited = parent.class_id if parent is not None else None
    await connection.execute(
        upsert(review_edits)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=user_id,
            kind=kind,
            number=found.number,
            split=found.split,
            retired=Retired.SPLIT,
        )
        .on_conflict_do_update(index_elements=KEY_COLUMNS, set_={"retired": Retired.SPLIT})
    )
    for part, made in zip(draft.parts, parts, strict=True):
        await connection.execute(
            upsert(review_edits).values(
                tenant_id=row.tenant_id,
                project_id=row.project_id,
                task_id=task_id,
                slide_id=slide_id,
                user_id=user_id,
                kind=kind,
                number=made.number,
                split=made.split,
                class_id=part.class_id or inherited,
                geometry=await outline(connection, kind, part.geometry),
            )
        )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_SPLIT,
        row,
        {"object": found.text(ascii=True), "parts": [made.text(ascii=True) for made in parts]},
    )
    return [
        await saved_edit(connection, task_id, slide_id, user_id, kind, key_of(made))
        for made in parts
    ]


@router.post(
    "/merges",
    operation_id="mergeReviewObjects",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def merge_review_objects(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    draft: MergeDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ReviewEdit:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    merged = [region(text) for text in draft.objects]
    try:
        keeper = merge_keeper(merged)
    except ObjectIdError as error:
        raise BadRequestError(str(error)) from error
    user_id = user_of(principal)
    rows = await fates_of(connection, task_id, slide_id, user_id, Letter.REGION)
    for found in merged:
        await require_live(connection, row, rows, found, deleted_too=False)
    if draft.class_id is not None:
        await check_classes(connection, row.project_id, {draft.class_id})
    kind = AnnotationKind.REGION
    base = {
        "tenant_id": row.tenant_id,
        "project_id": row.project_id,
        "task_id": task_id,
        "slide_id": slide_id,
        "user_id": user_id,
        "kind": kind,
    }
    kept: dict[str, Any] = {"geometry": await outline(connection, kind, draft.geometry)}
    if draft.class_id is not None:
        kept["class_id"] = draft.class_id
    await connection.execute(
        upsert(review_edits)
        .values(**base, number=keeper.number, split=keeper.split, **kept)
        .on_conflict_do_update(index_elements=KEY_COLUMNS, set_=kept)
    )
    alias = {
        "retired": Retired.MERGED,
        "merged_into_number": keeper.number,
        "merged_into_split": keeper.split,
    }
    others = [found for found in merged if found != keeper]
    for found in others:
        await connection.execute(
            upsert(review_edits)
            .values(**base, number=found.number, split=found.split, **alias)
            .on_conflict_do_update(index_elements=KEY_COLUMNS, set_=alias)
        )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_MERGED,
        row,
        {
            "object": keeper.text(ascii=True),
            "aliases": [found.text(ascii=True) for found in others],
        },
    )
    return await saved_edit(connection, task_id, slide_id, user_id, kind, key_of(keeper))


@router.get(
    "/objects/{object_id}",
    operation_id="resolveReviewObject",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def resolve_review_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> ObjectResolution:
    row = await task_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    found = ai_object(object_id)
    rows = await fates_of(connection, task_id, slide_id, reviewer, found.letter)
    await require_known(connection, row, rows, found)
    return ObjectResolution(
        task_id=task_id,
        slide_id=slide_id,
        reviewer_id=reviewer,
        object=found.text(ascii=True),
        current=[item.text(ascii=True) for item in resolve(found.letter, lineage(rows), found)],
    )


@router.post(
    "/added",
    operation_id="addReviewObject",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def add_review_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    draft: AddedDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Annotation:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    slide = SimpleNamespace(id=slide_id, project_id=row.project_id)
    annotation = AnnotationDraft(kind=draft.kind, geometry=draft.geometry, class_id=draft.class_id)
    (made,) = await add(connection, principal, slide, [annotation], task_id=task_id)
    created = (
        await connection.execute(select(*ANNOTATION_COLUMNS).where(annotations.c.id == made.id))
    ).one()
    return annotation_of(created)


@router.get(
    "/layer",
    operation_id="getReviewedLayer",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_reviewed_layer(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> ReviewedLayer:
    row = await task_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    edits = [
        edit_of(edit)
        for edit in await connection.execute(
            select(*EDIT_COLUMNS)
            .where(*mine(task_id, slide_id, reviewer))
            .order_by(review_edits.c.kind, review_edits.c.number, review_edits.c.split)
        )
    ]
    added = [
        annotation_of(item)
        for item in await connection.execute(
            select(*ANNOTATION_COLUMNS)
            .where(
                annotations.c.task_id == task_id,
                annotations.c.slide_id == slide_id,
                annotations.c.created_by_user_id == reviewer,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_([AnnotationKind.REGION, AnnotationKind.CELL]),
            )
            .order_by(annotations.c.kind, annotations.c.number)
        )
    ]
    counts = (
        await connection.execute(
            select(result_sets.c.region_count, result_sets.c.cell_count).where(
                result_sets.c.id == row.result_set_id
            )
        )
    ).one()
    live = [edit for edit in edits if not edit.deleted and edit.retired is None]
    hidden = await ai_hidden_on(connection, principal, row.project_id, slide_id)
    return ReviewedLayer(
        task_id=task_id,
        slide_id=slide_id,
        result_set_id=row.result_set_id,
        reviewer_id=reviewer,
        edits=edits,
        added=added,
        summary=LayerSummary(
            regions=None if hidden else counts.region_count,
            cells=None if hidden else counts.cell_count,
            retyped=sum(edit.class_id is not None for edit in live),
            reshaped=sum(edit.geometry is not None and not edit.split for edit in live),
            deleted=sum(edit.deleted and edit.retired is None for edit in edits),
            split=sum(edit.retired is Retired.SPLIT for edit in edits),
            merged=sum(edit.retired is Retired.MERGED for edit in edits),
            added=len(added),
        ),
    )
