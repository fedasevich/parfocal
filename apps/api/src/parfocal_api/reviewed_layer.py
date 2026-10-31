import json
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, model_validator
from sqlalchemy import delete, func, select
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
from parfocal_common.object_ids import Letter, ObjectId, ObjectIdError, parse

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


class AddedDraft(BaseModel):
    kind: Literal[AnnotationKind.REGION, AnnotationKind.CELL]
    geometry: Geometry
    class_id: uuid.UUID | None = None


class ReviewEdit(BaseModel):
    object: str
    kind: AnnotationKind
    number: int
    class_id: uuid.UUID | None
    geometry: dict[str, Any] | None
    deleted: bool
    updated_at: datetime


class LayerSummary(BaseModel):
    regions: int | None
    cells: int | None
    retyped: int
    reshaped: int
    deleted: int
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
    if found.letter not in KINDS or found.person or found.split:
        raise NotAnAiObjectError
    return found


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
    return ReviewEdit(
        object=ObjectId(letter, row.number).text(ascii=True),
        kind=kind,
        number=row.number,
        class_id=row.class_id,
        geometry=json.loads(row.geojson) if row.geojson else None,
        deleted=row.deleted,
        updated_at=row.updated_at,
    )


EDIT_COLUMNS = (
    review_edits.c.kind,
    review_edits.c.number,
    review_edits.c.class_id,
    func.ST_AsGeoJSON(review_edits.c.geometry).label("geojson"),
    review_edits.c.deleted,
    review_edits.c.updated_at,
)


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
    await check_exists(connection, row, found)
    kind = KINDS[found.letter]
    geometry = None
    if draft.geometry is not None:
        if draft.geometry.type not in SHAPES[kind]:
            raise InvalidShapeError(f"A {kind} cannot be a {draft.geometry.type}")
        shape = draft.geometry.model_dump_json()
        await check_shapes(connection, [shape])
        geometry = func.ST_SetSRID(func.ST_GeomFromGeoJSON(shape), 0)
    if draft.class_id is not None:
        await check_classes(connection, row.project_id, {draft.class_id})
    values = {"class_id": draft.class_id, "geometry": geometry, "deleted": draft.deleted}
    await connection.execute(
        upsert(review_edits)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=user_of(principal),
            kind=kind,
            number=found.number,
            **values,
        )
        .on_conflict_do_update(
            index_elements=[
                review_edits.c.task_id,
                review_edits.c.slide_id,
                review_edits.c.user_id,
                review_edits.c.kind,
                review_edits.c.number,
            ],
            set_=values,
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
    saved = (
        await connection.execute(
            select(*EDIT_COLUMNS).where(
                *mine(task_id, slide_id, user_of(principal)),
                review_edits.c.kind == kind,
                review_edits.c.number == found.number,
            )
        )
    ).one()
    return edit_of(saved)


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
    cleared = await connection.execute(
        delete(review_edits).where(
            *mine(task_id, slide_id, user_of(principal)),
            review_edits.c.kind == KINDS[found.letter],
            review_edits.c.number == found.number,
        )
    )
    if cleared.rowcount:
        await audit(
            connection,
            principal,
            AuditAction.REVIEW_OBJECT_RESTORED,
            row,
            {"object": found.text(ascii=True)},
        )
    return Response(status_code=204)


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
            .order_by(review_edits.c.kind, review_edits.c.number)
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
    live = [edit for edit in edits if not edit.deleted]
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
            reshaped=sum(edit.geometry is not None for edit in live),
            deleted=sum(edit.deleted for edit in edits),
            added=len(added),
        ),
    )
