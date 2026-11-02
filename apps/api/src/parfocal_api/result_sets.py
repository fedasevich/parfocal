import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field, StringConstraints
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden, ai_hidden_on, require_ai_shown
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, readable_slide, require_slide_reading
from parfocal_api.projects import ProjectArchivedError, visible
from parfocal_api.tables import (
    PrivacyMode,
    ResultObjectKind,
    ResultSource,
    ResultStatus,
    projects,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
    review_task_slides,
    slides,
    verdicts,
)
from parfocal_api.taxonomy import resolve_names
from parfocal_common.chunk_store import ChunkEntry

MAX_CLASSES = 255

type Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


def distinct_names(names: list[str]) -> list[str]:
    folded = [name.casefold() for name in names]
    if len(set(folded)) != len(folded):
        raise ValueError("Each class name appears once")
    return names


class ResultSetDraft(BaseModel):
    name: Name
    model_version: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None
    ) = None
    source_file: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = (
        None
    )
    produced_at: datetime | None = None
    classes: Annotated[
        list[Name], Field(max_length=MAX_CLASSES), AfterValidator(distinct_names)
    ] = []


class ResultSetClass(BaseModel):
    position: int
    source_name: str
    class_id: uuid.UUID | None
    object_count: int


class ResultSet(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    slide_id: uuid.UUID
    name: str
    model_version: str | None
    source: ResultSource
    source_file: str | None
    produced_at: datetime | None
    status: ResultStatus
    error_code: str | None
    cell_count: int
    region_count: int
    zone_count: int
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class ResultSetDetail(ResultSet):
    classes: list[ResultSetClass]


class UploadingNotAllowedError(ForbiddenError):
    code = "uploading-not-allowed"
    title = "Only an owner of this project adds or removes AI results"


class ResultSetNotImportingError(ConflictError):
    code = "result-set-not-importing"
    title = "This result set is finished and cannot change"


class ResultSetInReviewError(ConflictError):
    code = "result-set-in-review"
    title = "Review work uses this result set. Confirm to delete it"


class ResultSetDeletion(BaseModel):
    tasks: int
    decisions: int


class UnknownClassPositionError(BadRequestError):
    code = "unknown-class-position"
    title = "An object names a class the result set does not have"


slide_router = APIRouter(prefix="/api/slides/{slide_id}/result-sets", tags=["result-sets"])
project_router = APIRouter(prefix="/api/projects/{project_id}/result-sets", tags=["result-sets"])
router = APIRouter(prefix="/api/result-sets", tags=["result-sets"])


def result_set_of(row: Any) -> ResultSet:
    return ResultSet.model_validate(row, from_attributes=True)


async def slide_row(connection: AsyncConnection, principal: Principal, slide_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(
                slides.c.id, slides.c.project_id, projects.c.privacy_mode, projects.c.archived_at
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Slide not found",
    )
    return row


async def require_uploading(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, archived: bool
) -> None:
    grant = await project_grant(connection, principal, project_id, Permission.UPLOAD_SLIDES)
    if grant is not Grant.ALL:
        raise UploadingNotAllowedError
    if archived:
        raise ProjectArchivedError


async def set_row(connection: AsyncConnection, principal: Principal, set_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(result_sets, projects.c.privacy_mode, projects.c.archived_at)
            .join(projects, projects.c.id == result_sets.c.project_id)
            .where(result_sets.c.id == set_id, result_sets.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Result set not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        row.slide_id,
        "Result set not found",
    )
    return row


async def classes_of(connection: AsyncConnection, set_id: uuid.UUID) -> list[ResultSetClass]:
    rows = await connection.execute(
        select(result_set_classes)
        .where(result_set_classes.c.result_set_id == set_id)
        .order_by(result_set_classes.c.position)
    )
    return [ResultSetClass.model_validate(row, from_attributes=True) for row in rows]


async def detail_of(connection: AsyncConnection, row: Any) -> ResultSetDetail:
    return ResultSetDetail(
        **result_set_of(row).model_dump(), classes=await classes_of(connection, row.id)
    )


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    tenant_id: uuid.UUID,
    set_id: uuid.UUID,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.RESULT_SET,
        set_id,
        tenant_id=tenant_id,
        details=details,
    )


async def insert_result_set(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    slide: Any,
    draft: ResultSetDraft,
    source: ResultSource,
    actor: Actor,
    created_by_user_id: uuid.UUID | None,
    job_id: uuid.UUID | None = None,
    set_id: uuid.UUID | None = None,
) -> uuid.UUID:
    created = await connection.scalar(
        insert(result_sets)
        .values(
            **({"id": set_id} if set_id is not None else {}),
            tenant_id=tenant_id,
            project_id=slide.project_id,
            slide_id=slide.id,
            name=draft.name,
            model_version=draft.model_version or None,
            source=source,
            source_file=draft.source_file or None,
            produced_at=draft.produced_at,
            job_id=job_id,
            created_by_user_id=created_by_user_id,
        )
        .returning(result_sets.c.id)
    )
    assert isinstance(created, uuid.UUID)
    if draft.classes:
        resolved = await resolve_names(connection, slide.project_id, draft.classes)
        await connection.execute(
            insert(result_set_classes),
            [
                {
                    "tenant_id": tenant_id,
                    "project_id": slide.project_id,
                    "result_set_id": created,
                    "position": position,
                    "source_name": item.source_name,
                    "class_id": item.class_id,
                }
                for position, item in enumerate(resolved)
            ],
        )
    await record(
        connection,
        actor,
        AuditAction.RESULT_SET_CREATED,
        AuditTarget.RESULT_SET,
        created,
        tenant_id=tenant_id,
        details={"slide_id": str(slide.id), "source": source.value, "classes": len(draft.classes)},
    )
    return created


async def open_result_set(
    connection: AsyncConnection,
    principal: Principal,
    slide: Any,
    draft: ResultSetDraft,
    source: ResultSource,
    job_id: uuid.UUID | None = None,
) -> uuid.UUID:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    return await insert_result_set(
        connection,
        tenant_id,
        slide,
        draft,
        source,
        actor_of(principal),
        principal.user_id if isinstance(principal, MemberPrincipal) else None,
        job_id,
    )


@dataclass(frozen=True)
class RegionRow:
    kind: ResultObjectKind
    number: int
    wkt: str
    class_position: int | None = None
    score: int | None = None
    probabilities: Sequence[int] | None = None
    parent_number: int | None = None


@dataclass(frozen=True)
class ChunkRow:
    chunk: int
    x: int
    y: int
    width: int
    height: int
    cell_count: int
    vertex_count: int
    object_key: str

    @classmethod
    def of(cls, entry: ChunkEntry) -> ChunkRow:
        return cls(
            entry.chunk,
            entry.x,
            entry.y,
            entry.width,
            entry.height,
            entry.cell_count,
            entry.vertex_count,
            entry.object_key,
        )


async def importing(connection: AsyncConnection, set_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(result_sets.c.tenant_id, result_sets.c.status).where(result_sets.c.id == set_id)
        )
    ).one()
    if row.status != ResultStatus.IMPORTING:
        raise ResultSetNotImportingError
    return row


async def add_regions(
    connection: AsyncConnection, set_id: uuid.UUID, regions: Sequence[RegionRow]
) -> None:
    owner = await importing(connection, set_id)
    known = {item.position for item in await classes_of(connection, set_id)}
    if any(r.class_position is not None and r.class_position not in known for r in regions):
        raise UnknownClassPositionError
    if regions:
        await connection.execute(
            insert(result_objects),
            [
                {
                    "tenant_id": owner.tenant_id,
                    "result_set_id": set_id,
                    "kind": region.kind,
                    "number": region.number,
                    "geometry": f"SRID=0;{region.wkt}",
                    "class_index": region.class_position,
                    "score": region.score,
                    "probabilities": list(region.probabilities)
                    if region.probabilities is not None
                    else None,
                    "parent_number": region.parent_number,
                }
                for region in regions
            ],
        )


async def add_chunks(
    connection: AsyncConnection, set_id: uuid.UUID, chunks: Sequence[ChunkRow]
) -> None:
    owner = await importing(connection, set_id)
    if chunks:
        await connection.execute(
            insert(result_chunks),
            [
                {"tenant_id": owner.tenant_id, "result_set_id": set_id, **vars(chunk)}
                for chunk in chunks
            ],
        )


def cells_per_class(entries: Sequence[ChunkEntry]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for entry in entries:
        for position, count in enumerate(entry.class_counts):
            if count:
                counts[position] = counts.get(position, 0) + count
    return counts


async def finish(
    connection: AsyncConnection, set_id: uuid.UUID, class_cells: Mapping[int, int] | None = None
) -> None:
    await importing(connection, set_id)
    cells = select(func.coalesce(func.sum(result_chunks.c.cell_count), 0)).where(
        result_chunks.c.result_set_id == set_id
    )
    counted = (
        select(result_objects.c.kind, func.count())
        .where(result_objects.c.result_set_id == set_id)
        .group_by(result_objects.c.kind)
    )
    by_kind = {str(kind): int(count) for kind, count in await connection.execute(counted)}
    per_class = (
        select(result_objects.c.class_index, func.count())
        .where(result_objects.c.result_set_id == set_id, result_objects.c.class_index.is_not(None))
        .group_by(result_objects.c.class_index)
    )
    totals = dict(class_cells or {})
    for position, count in (await connection.execute(per_class)).all():
        totals[position] = totals.get(position, 0) + count
    for position, count in sorted(totals.items()):
        await connection.execute(
            update(result_set_classes)
            .where(
                result_set_classes.c.result_set_id == set_id,
                result_set_classes.c.position == position,
            )
            .values(object_count=result_set_classes.c.object_count + count)
        )
    await connection.execute(
        update(result_sets)
        .where(result_sets.c.id == set_id)
        .values(
            status=ResultStatus.READY,
            cell_count=cells.scalar_subquery(),
            region_count=by_kind.get(ResultObjectKind.REGION, 0),
            zone_count=by_kind.get(ResultObjectKind.ZONE, 0),
        )
    )


async def fail(connection: AsyncConnection, set_id: uuid.UUID, error_code: str) -> None:
    await importing(connection, set_id)
    await connection.execute(
        update(result_sets)
        .where(result_sets.c.id == set_id)
        .values(status=ResultStatus.FAILED, error_code=error_code)
    )


@slide_router.post(
    "",
    operation_id="createResultSet",
    status_code=201,
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def create_result_set(
    slide_id: uuid.UUID,
    draft: ResultSetDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ResultSetDetail:
    slide = await slide_row(connection, principal, slide_id)
    await require_uploading(connection, principal, slide.project_id, slide.archived_at is not None)
    set_id = await open_result_set(connection, principal, slide, draft, ResultSource.IMPORT)
    return await detail_of(connection, await set_row(connection, principal, set_id))


@slide_router.get(
    "", operation_id="listSlideResultSets", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_slide_result_sets(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ResultSet]:
    slide = await slide_row(connection, principal, slide_id)
    if await ai_hidden_on(connection, principal, slide.project_id, slide_id):
        return []
    rows = await connection.execute(
        select(result_sets)
        .where(result_sets.c.slide_id == slide_id, result_sets.c.deleted_at.is_(None))
        .order_by(result_sets.c.created_at)
    )
    return [result_set_of(row) for row in rows]


@project_router.get(
    "", operation_id="listProjectResultSets", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_project_result_sets(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ResultSet]:
    await visible(connection, principal, project_id)
    rows = await connection.execute(
        select(result_sets)
        .where(
            result_sets.c.project_id == project_id,
            result_sets.c.deleted_at.is_(None),
            readable_slide(principal, result_sets.c.project_id, result_sets.c.slide_id),
            ~ai_hidden(principal, result_sets.c.project_id, result_sets.c.slide_id),
        )
        .order_by(result_sets.c.created_at)
    )
    return [result_set_of(row) for row in rows]


@router.get(
    "/{result_set_id}",
    operation_id="getResultSet",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_result_set(
    result_set_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ResultSetDetail:
    row = await set_row(connection, principal, result_set_id)
    await require_ai_shown(connection, principal, row.project_id, row.slide_id)
    return await detail_of(connection, row)


def counted(number: int, noun: str) -> str:
    return f"{number} {noun}" if number == 1 else f"{number} {noun}s"


async def review_use(connection: AsyncConnection, set_id: uuid.UUID) -> ResultSetDeletion:
    in_tasks = select(review_task_slides.c.task_id, review_task_slides.c.slide_id).where(
        review_task_slides.c.result_set_id == set_id
    )
    tasks = await connection.scalar(
        select(func.count(func.distinct(review_task_slides.c.task_id))).where(
            review_task_slides.c.result_set_id == set_id
        )
    )
    decisions = await connection.scalar(
        select(func.count())
        .select_from(verdicts)
        .where(func.row(verdicts.c.task_id, verdicts.c.slide_id).in_(in_tasks))
    )
    return ResultSetDeletion(tasks=int(tasks or 0), decisions=int(decisions or 0))


@router.delete(
    "/{result_set_id}",
    operation_id="deleteResultSet",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def delete_result_set(
    result_set_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    confirm: bool = False,
) -> ResultSetDeletion:
    row = await set_row(connection, principal, result_set_id)
    await require_uploading(connection, principal, row.project_id, row.archived_at is not None)
    use = await review_use(connection, result_set_id)
    if use.tasks and not confirm:
        raise ResultSetInReviewError(
            f"Used by {counted(use.tasks, 'review task')} and {counted(use.decisions, 'decision')}"
        )
    await connection.execute(
        update(result_sets).where(result_sets.c.id == result_set_id).values(deleted_at=func.now())
    )
    await audit(
        connection,
        principal,
        AuditAction.RESULT_SET_DELETED,
        row.tenant_id,
        result_set_id,
        {"slide_id": str(row.slide_id), "tasks": use.tasks, "decisions": use.decisions},
    )
    return use
