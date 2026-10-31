import asyncio
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
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError
from parfocal_api.reviewed_layer import KINDS, task_slide
from parfocal_api.tables import (
    AnnotationKind,
    ResultObjectKind,
    annotations,
    result_chunks,
    result_objects,
    review_order,
)
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import MissingObjectError, ResultStore
from parfocal_common.review_order import (
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
        data = await asyncio.to_thread(store.get, object_key)
    except MissingObjectError as error:
        raise ResultFilesMissingError from error
    return CellChunk.read(data)


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


async def ordered_cells(
    connection: AsyncConnection,
    store: ResultStore,
    scope: Scope,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
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
            pool.add(await read_chunk(store, object_key))
        return pool.sample(scope.count, scope.seed, slide_key)
    found: list[Rated] = []
    for object_key in keys:
        chunk = await read_chunk(store, object_key)
        if scope.kind is ScopeKind.CELLS_BELOW_SCORE:
            found += scoped_cells(scope, chunk, slide_key)
            continue
        inside = await inside_cells(connection, scope, slide_id, set_id, chunk)
        if scope.kind is ScopeKind.INSIDE_ROIS:
            found += scoped_cells(scope, chunk, slide_key, inside_roi=inside)
        else:
            found += scoped_cells(scope, chunk, slide_key, inside_zone=inside)
    return found


async def order_of_slide(
    connection: AsyncConnection,
    store: ResultStore,
    scope: Scope,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    seed: int,
) -> list[ObjectKey]:
    regions = await ordered_regions(connection, scope, slide_id, set_id)
    cells = await ordered_cells(connection, store, scope, slide_id, set_id)
    return least_sure_first([*regions, *cells], seed, str(slide_id))


async def store_order(
    connection: AsyncConnection,
    store: ResultStore,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    scope: Scope,
    sets: Mapping[uuid.UUID, uuid.UUID],
    seeds: Mapping[uuid.UUID, int],
) -> None:
    rows: list[dict[str, Any]] = []
    for slide_id, set_id in sets.items():
        keys = await order_of_slide(connection, store, scope, slide_id, set_id, seeds[slide_id])
        rows.append(
            {
                "tenant_id": tenant_id,
                "project_id": project_id,
                "task_id": task_id,
                "slide_id": slide_id,
                "seed": seeds[slide_id],
                "count": len(keys),
                "objects": pack(keys),
            }
        )
    await connection.execute(
        delete(review_order).where(
            review_order.c.task_id == task_id, review_order.c.slide_id.in_(list(sets))
        )
    )
    if rows:
        await connection.execute(insert(review_order), rows)


async def stored_seeds(
    connection: AsyncConnection, task_id: uuid.UUID, slide_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int]:
    rows = await connection.execute(
        select(review_order.c.slide_id, review_order.c.seed).where(
            review_order.c.task_id == task_id, review_order.c.slide_id.in_(list(slide_ids))
        )
    )
    return {row[0]: row[1] for row in rows}


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
    await task_slide(connection, principal, task_id, slide_id)
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
