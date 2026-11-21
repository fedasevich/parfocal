import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import result_chunks, result_objects, review_ai_outlines
from parfocal_common.cell_chunks import ChunkError
from parfocal_common.chunk_store import read_chunk
from parfocal_common.result_store import MissingObjectError, ResultStore

MIN_RING_VALUES = 6


def polygon_of(ring: list[float]) -> str | None:
    if len(ring) < MIN_RING_VALUES:
        return None
    points = [[ring[index], ring[index + 1]] for index in range(0, len(ring) - 1, 2)]
    return json.dumps({"type": "Polygon", "coordinates": [[*points, points[0]]]})


async def cell_ring(
    connection: AsyncConnection, store: ResultStore, set_id: uuid.UUID, number: int
) -> list[float] | None:
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == set_id)
        .order_by(result_chunks.c.chunk)
    )
    for object_key in keys.all():
        try:
            cells = await read_chunk(store, object_key)
        except MissingObjectError, ChunkError:
            continue
        for cell in cells:
            if cell.number == number:
                return list(cell.ring)
    return None


async def keep_ai_outline(
    connection: AsyncConnection,
    store: ResultStore,
    row: Any,
    kind: str,
    number: int,
) -> None:
    set_id = row.result_set_id
    if set_id is None:
        return
    key = {
        "task_id": row.task_id,
        "slide_id": row.slide_id,
        "kind": kind,
        "number": number,
    }
    kept = await connection.scalar(
        select(review_ai_outlines.c.number).where(
            *(review_ai_outlines.c[name] == value for name, value in key.items())
        )
    )
    if kept is not None:
        return
    if kind == "region":
        shape = await connection.scalar(
            select(func.ST_AsGeoJSON(result_objects.c.geometry)).where(
                result_objects.c.result_set_id == set_id,
                result_objects.c.kind == "region",
                result_objects.c.number == number,
            )
        )
    else:
        ring = await cell_ring(connection, store, set_id, number)
        shape = None if ring is None else polygon_of(ring)
    if shape is None:
        return
    outline = func.ST_SetSRID(func.ST_GeomFromGeoJSON(shape), 0)
    valid = await connection.scalar(
        select(func.ST_IsValid(outline) & (func.ST_Dimension(outline) == 2))
    )
    if not valid:
        return
    await connection.execute(
        upsert(review_ai_outlines)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            outline=outline,
            **key,
        )
        .on_conflict_do_nothing()
    )
