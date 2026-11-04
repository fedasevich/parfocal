import uuid
from collections.abc import Mapping, Sequence
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Float,
    and_,
    bindparam,
    delete,
    exists,
    func,
    insert,
    select,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import calibration_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError
from parfocal_api.reviewed_layer import KINDS, review_slide
from parfocal_api.tables import (
    AnnotationKind,
    ResultObjectKind,
    annotations,
    model_runs,
    result_chunks,
    result_objects,
    result_sets,
    review_order,
    review_task_slides,
)
from parfocal_common.cell_chunks import ChunkError
from parfocal_common.chunk_store import chunk_of
from parfocal_common.jobs import (
    JobControl,
    JobStatus,
    Step,
    StepRun,
    Workflow,
    enqueue,
    jobs,
    move,
)
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import MissingObjectError, ResultStore
from parfocal_common.review_order import (
    UNCALIBRATED,
    CellChunk,
    CellPool,
    Rated,
    certainty_of,
    least_sure_first,
    pack,
    scoped_cells,
    unpack,
)
from parfocal_common.scope import Candidate, ObjectKey, Scope, ScopeKind, in_scope

PAGE = 200
MAX_PAGE = 1000
BYTES_PER_OBJECT = 5
ORDER_KIND = "review-order"
ORDER_STEP = "order"
ORDER_LEASE_SECONDS = 120.0
WAITING = frozenset({JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING})
CANCELLABLE = frozenset({JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED})


class OrderedObject(BaseModel):
    object: str
    kind: AnnotationKind
    number: int


class ReviewOrder(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    total: int
    offset: int
    objects: list[OrderedObject]


class ResultFilesMissingError(ConflictError):
    code = "result-files-missing"
    title = "A cell file of this result set is missing from storage"


class ResultFilesUnreadableError(ConflictError):
    code = "result-files-unreadable"
    title = "A cell file of this result set cannot be read"


class ReviewOrderNotReadyError(ConflictError):
    code = "review-order-not-ready"
    title = "The review order of this slide is still being worked out"


class ReviewOrderFailedError(ConflictError):
    code = "review-order-failed"
    title = "The review order of this slide could not be worked out"


FAILURES: dict[str, type[ConflictError]] = {
    error.code: error for error in (ResultFilesMissingError, ResultFilesUnreadableError)
}


class OrderRunsInAWorkerError(RuntimeError):
    pass


async def runs_in_a_worker(step: StepRun) -> Mapping[str, Any]:
    raise OrderRunsInAWorkerError(step.job_id)


ORDER_PLAN = Workflow(
    kind=ORDER_KIND,
    steps=[Step(ORDER_STEP, runs_in_a_worker)],
    lease_seconds=ORDER_LEASE_SECONDS,
)


def reads_cells(scopes: Sequence[Scope]) -> bool:
    return any(scope.kind is not ScopeKind.ALL_REGIONS for scope in scopes)


def order_jobs(task_id: uuid.UUID) -> ColumnElement[bool]:
    return and_(jobs.c.kind == ORDER_KIND, jobs.c.input["task_id"].astext == str(task_id))


def result_store(request: Request) -> ResultStore:
    return cast("ResultStore", request.app.results)


type Results = Annotated[ResultStore, Depends(result_store)]

router = APIRouter(prefix="/api/review-tasks/{task_id}/slides/{slide_id}", tags=["review-tasks"])


def roi_on(slide_id: uuid.UUID, shape: ColumnElement[Any]) -> ColumnElement[bool]:
    return exists().where(
        annotations.c.slide_id == slide_id,
        annotations.c.kind == AnnotationKind.ROI,
        annotations.c.deleted_at.is_(None),
        func.ST_Intersects(annotations.c.geometry, shape),
    )


def zone_of(set_id: uuid.UUID, shape: ColumnElement[Any]) -> ColumnElement[bool]:
    zones = result_objects.alias("zones")
    return exists().where(
        zones.c.result_set_id == set_id,
        zones.c.kind == ResultObjectKind.ZONE,
        func.ST_Intersects(zones.c.geometry, shape),
    )


def tile() -> ColumnElement[Any]:
    return func.ST_MakeEnvelope(
        result_chunks.c.x,
        result_chunks.c.y,
        result_chunks.c.x + result_chunks.c.width,
        result_chunks.c.y + result_chunks.c.height,
        0,
    )


async def ordered_regions(
    connection: AsyncConnection, scope: Scope, slide_id: uuid.UUID, set_id: uuid.UUID
) -> list[Rated]:
    rows = (
        await connection.execute(
            select(
                result_objects.c.number,
                result_objects.c.class_index,
                result_objects.c.score,
                result_objects.c.probabilities,
                roi_on(slide_id, result_objects.c.geometry).label("inside_roi"),
            ).where(
                result_objects.c.result_set_id == set_id,
                result_objects.c.kind == ResultObjectKind.REGION,
            )
        )
    ).all()
    candidates = [
        Candidate(Letter.REGION, row.number, score=row.score, inside_roi=row.inside_roi)
        for row in rows
    ]
    chosen = set(in_scope(scope, candidates, str(slide_id)))
    return [
        Rated(
            (Letter.REGION, row.number), certainty_of(row.class_index, row.score, row.probabilities)
        )
        for row in rows
        if (Letter.REGION, row.number) in chosen
    ]


async def chunk_keys(
    connection: AsyncConnection, scope: Scope, slide_id: uuid.UUID, set_id: uuid.UUID
) -> list[str]:
    statement = select(result_chunks.c.object_key).where(result_chunks.c.result_set_id == set_id)
    if scope.kind is ScopeKind.INSIDE_ROIS:
        statement = statement.where(roi_on(slide_id, tile()))
    elif scope.kind is ScopeKind.UNSURE_ZONES:
        statement = statement.where(zone_of(set_id, tile()))
    return list(await connection.scalars(statement.order_by(result_chunks.c.chunk)))


async def read_chunk(store: ResultStore, object_key: str) -> CellChunk:
    try:
        data = await store.get(object_key)
    except MissingObjectError as error:
        raise ResultFilesMissingError from error
    try:
        return CellChunk.of(*chunk_of(data))
    except ChunkError as error:
        raise ResultFilesUnreadableError from error


async def inside_cells(
    connection: AsyncConnection,
    scope: Scope,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    chunk: CellChunk,
) -> set[int]:
    centres = [(chunk.numbers[index], chunk.centre(index)) for index in range(len(chunk))]
    placed = [(number, centre) for number, centre in centres if centre is not None]
    if not placed:
        return set()
    points = (
        func.unnest(
            bindparam("numbers", [number for number, _ in placed], ARRAY[int](BigInteger())),
            bindparam("xs", [centre[0] for _, centre in placed], ARRAY[float](Float())),
            bindparam("ys", [centre[1] for _, centre in placed], ARRAY[float](Float())),
        )
        .table_valued("number", "x", "y")
        .render_derived(with_types=False)
    )
    point = func.ST_SetSRID(func.ST_MakePoint(points.c.x, points.c.y), 0)
    if scope.kind is ScopeKind.INSIDE_ROIS:
        holds = exists().where(
            annotations.c.slide_id == slide_id,
            annotations.c.kind == AnnotationKind.ROI,
            annotations.c.deleted_at.is_(None),
            func.ST_Contains(annotations.c.geometry, point),
        )
    else:
        holds = exists().where(
            and_(
                result_objects.c.result_set_id == set_id,
                result_objects.c.kind == ResultObjectKind.ZONE,
                func.ST_Contains(result_objects.c.geometry, point),
            )
        )
    found = await connection.scalars(select(points.c.number).where(holds))
    return {int(number) for number in found}


async def temperature_of(connection: AsyncConnection, set_id: uuid.UUID) -> float:
    run = (
        await connection.execute(
            select(
                model_runs.c.detector,
                model_runs.c.detector_version,
                model_runs.c.typer,
                model_runs.c.typer_version,
                model_runs.c.test_time_views,
            )
            .join(result_sets, result_sets.c.job_id == model_runs.c.job_id)
            .where(result_sets.c.id == set_id)
        )
    ).first()
    if run is None:
        return UNCALIBRATED
    typed_by = (
        (run.typer, run.typer_version)
        if run.typer is not None and run.typer_version is not None
        else (run.detector, run.detector_version)
    )
    calibration = calibration_of(*typed_by, run.test_time_views)
    return calibration.temperature if calibration is not None else UNCALIBRATED


async def ordered_cells(
    connection: AsyncConnection,
    store: ResultStore,
    scope: Scope,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    temperature: float = UNCALIBRATED,
) -> list[Rated]:
    if scope.kind is ScopeKind.ALL_REGIONS:
        return []
    keys = await chunk_keys(connection, scope, slide_id, set_id)
    slide_key = str(slide_id)
    if scope.kind is ScopeKind.RANDOM_CELLS:
        if scope.count is None or scope.seed is None:
            raise ValueError("A random sample needs a count and a seed")
        pool = CellPool()
        for object_key in keys:
            pool.add(await read_chunk(store, object_key), temperature)
        return pool.sample(scope.count, scope.seed, slide_key)
    found: list[Rated] = []
    for object_key in keys:
        chunk = await read_chunk(store, object_key)
        if scope.kind in {ScopeKind.CELLS_BELOW_SCORE, ScopeKind.ALL_CELLS}:
            found += scoped_cells(scope, chunk, slide_key, temperature=temperature)
            continue
        inside = await inside_cells(connection, scope, slide_id, set_id, chunk)
        if scope.kind is ScopeKind.INSIDE_ROIS:
            found += scoped_cells(
                scope, chunk, slide_key, inside_roi=inside, temperature=temperature
            )
        else:
            found += scoped_cells(
                scope, chunk, slide_key, inside_zone=inside, temperature=temperature
            )
    return found


async def order_of_slide(
    connection: AsyncConnection,
    store: ResultStore,
    scopes: Sequence[Scope],
    slide_id: uuid.UUID,
    set_ids: Sequence[uuid.UUID],
    seed: int,
    least_sure: bool = True,
) -> list[ObjectKey]:
    rated: dict[ObjectKey, Rated] = {}
    for set_id in set_ids:
        temperature = await temperature_of(connection, set_id)
        for scope in scopes:
            regions = await ordered_regions(connection, scope, slide_id, set_id)
            cells = await ordered_cells(connection, store, scope, slide_id, set_id, temperature)
            for item in [*regions, *cells]:
                rated.setdefault(item.key, item)
    if not least_sure:
        return sorted(rated)
    return least_sure_first(list(rated.values()), seed, str(slide_id))


async def write_order(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    seed: int,
    keys: Sequence[ObjectKey],
) -> None:
    await connection.execute(
        delete(review_order).where(
            review_order.c.task_id == task_id, review_order.c.slide_id == slide_id
        )
    )
    await connection.execute(
        insert(review_order).values(
            tenant_id=tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            seed=seed,
            count=len(keys),
            objects=pack(keys),
        )
    )


async def checked_keys(
    connection: AsyncConnection, task_id: uuid.UUID
) -> set[tuple[uuid.UUID, Letter, int]]:
    rows = await connection.execute(
        select(annotations.c.slide_id, annotations.c.kind, annotations.c.source_number).where(
            annotations.c.task_id == task_id, annotations.c.source_number.is_not(None)
        )
    )
    letters = {kind: letter for letter, kind in KINDS.items()}
    return {
        (row.slide_id, letters[AnnotationKind(row.kind)], row.source_number)
        for row in rows
        if AnnotationKind(row.kind) in letters
    }


async def unchecked_objects(connection: AsyncConnection, task_id: uuid.UUID) -> int:
    with_sets = set(
        await connection.scalars(
            select(review_task_slides.c.slide_id).where(
                review_task_slides.c.task_id == task_id,
                review_task_slides.c.result_set_id.is_not(None),
            )
        )
    )
    orders = (
        await connection.execute(
            select(review_order.c.slide_id, review_order.c.objects).where(
                review_order.c.task_id == task_id
            )
        )
    ).all()
    if with_sets - {row.slide_id for row in orders}:
        await order_state(connection, task_id)
    checked = await checked_keys(connection, task_id)
    return sum(
        (row.slide_id, letter, number) not in checked
        for row in orders
        for letter, number in unpack(bytes(row.objects))
    )


async def cancel_order_jobs(connection: AsyncConnection, task_id: uuid.UUID) -> None:
    live = await connection.scalars(
        select(jobs.c.id).where(order_jobs(task_id), jobs.c.status.in_(list(CANCELLABLE)))
    )
    for job_id in live.all():
        await move(connection, job_id, JobControl.CANCEL)


async def clear_order(connection: AsyncConnection, task_id: uuid.UUID) -> None:
    await cancel_order_jobs(connection, task_id)
    await connection.execute(delete(review_order).where(review_order.c.task_id == task_id))


async def store_order(
    connection: AsyncConnection,
    store: ResultStore,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    scopes: Sequence[Scope],
    sets: Mapping[uuid.UUID, Sequence[uuid.UUID]],
    seeds: Mapping[uuid.UUID, int],
    least_sure: bool = True,
) -> uuid.UUID | None:
    await cancel_order_jobs(connection, task_id)
    if reads_cells(scopes):
        await connection.execute(
            delete(review_order).where(
                review_order.c.task_id == task_id, review_order.c.slide_id.in_(list(sets))
            )
        )
        return await enqueue(
            connection,
            ORDER_PLAN,
            tenant_id,
            project_id,
            {
                "task_id": str(task_id),
                "slides": [[str(slide_id), seeds[slide_id]] for slide_id in sets],
            },
        )
    for slide_id, set_ids in sets.items():
        keys = await order_of_slide(
            connection, store, scopes, slide_id, set_ids, seeds[slide_id], least_sure
        )
        await write_order(
            connection, tenant_id, project_id, task_id, slide_id, seeds[slide_id], keys
        )
    return None


async def order_state(connection: AsyncConnection, task_id: uuid.UUID) -> None:
    latest = (
        await connection.execute(
            select(jobs.c.status, jobs.c.error_code)
            .where(order_jobs(task_id))
            .order_by(jobs.c.created_at.desc())
            .limit(1)
        )
    ).one_or_none()
    if latest is None:
        return
    if latest.status in WAITING:
        raise ReviewOrderNotReadyError
    if latest.status == JobStatus.FAILED:
        raise FAILURES.get(latest.error_code or "", ReviewOrderFailedError)


async def stored_seeds(
    connection: AsyncConnection, task_id: uuid.UUID, slide_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int]:
    queued = await connection.scalar(
        select(jobs.c.input).where(order_jobs(task_id)).order_by(jobs.c.created_at.desc()).limit(1)
    )
    job_input = cast("dict[str, list[tuple[str, int]]]", queued or {})
    slides = job_input.get("slides", [])
    seeds = {uuid.UUID(slide): int(seed) for slide, seed in slides}
    rows = await connection.execute(
        select(review_order.c.slide_id, review_order.c.seed).where(
            review_order.c.task_id == task_id
        )
    )
    seeds |= {row[0]: row[1] for row in rows}
    return {slide_id: seeds[slide_id] for slide_id in slide_ids if slide_id in seeds}


@router.get(
    "/order", operation_id="getReviewOrder", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_review_order(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = PAGE,
) -> ReviewOrder:
    await review_slide(connection, principal, task_id, slide_id)
    row = (
        await connection.execute(
            select(
                review_order.c.count.label("total"),
                func.substring(
                    review_order.c.objects, offset * BYTES_PER_OBJECT + 1, limit * BYTES_PER_OBJECT
                ).label("page"),
            ).where(review_order.c.task_id == task_id, review_order.c.slide_id == slide_id)
        )
    ).one_or_none()
    if row is None:
        await order_state(connection, task_id)
    keys = unpack(bytes(row.page)) if row is not None else []
    return ReviewOrder(
        task_id=task_id,
        slide_id=slide_id,
        total=row.total if row is not None else 0,
        offset=offset,
        objects=[
            OrderedObject(
                object=ObjectId(letter, number).text(ascii=True),
                kind=KINDS[letter],
                number=number,
            )
            for letter, number in keys
        ],
    )
