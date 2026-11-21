import asyncio
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.review_order import ResultFilesMissingError, ResultFilesUnreadableError
from parfocal_api.reviewed_layer import UnknownObjectError, check_exists
from parfocal_api.tables import result_chunks, result_objects
from parfocal_common.cell_chunks import ChunkError
from parfocal_common.chunk_store import Cell, read_chunk
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import MissingObjectError, ResultStore


async def stored_cells(store: ResultStore, object_key: str) -> list[Cell]:
    try:
        return await read_chunk(store, object_key)
    except MissingObjectError as error:
        raise ResultFilesMissingError from error
    except ChunkError as error:
        raise ResultFilesUnreadableError from error


PARALLEL_CHUNK_READS = 16


async def sets_holding_cell(
    store: ResultStore, number: int, chunk_keys: Mapping[uuid.UUID, Sequence[str]]
) -> set[uuid.UUID]:
    gate = asyncio.Semaphore(PARALLEL_CHUNK_READS)

    async def holds(keys: Sequence[str]) -> bool:
        for key in keys:
            try:
                async with gate:
                    cells = await stored_cells(store, key)
            except ResultFilesMissingError, ResultFilesUnreadableError:
                return False
            if any(cell.number == number for cell in cells):
                return True
        return False

    sets = list(chunk_keys)
    answers = await asyncio.gather(*(holds(chunk_keys[set_id]) for set_id in sets))
    return {set_id for set_id, held in zip(sets, answers, strict=True) if held}


async def chunk_keys_of(
    connection: AsyncConnection, set_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    keys: dict[uuid.UUID, list[str]] = {set_id: [] for set_id in set_ids}
    if not set_ids:
        return keys
    rows = await connection.execute(
        select(result_chunks.c.result_set_id, result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id.in_(set_ids))
        .order_by(result_chunks.c.result_set_id, result_chunks.c.chunk)
    )
    for row in rows:
        keys[row.result_set_id].append(row.object_key)
    return keys


async def missing_regions(
    connection: AsyncConnection, set_id: uuid.UUID, numbers: set[int]
) -> set[int]:
    if not numbers:
        return set()
    present = await connection.scalars(
        select(result_objects.c.number).where(
            result_objects.c.result_set_id == set_id,
            result_objects.c.kind == "region",
            result_objects.c.number.in_(numbers),
        )
    )
    return numbers - set(present)


async def missing_cells(
    connection: AsyncConnection, store: ResultStore, set_id: uuid.UUID, numbers: set[int]
) -> set[int]:
    left = set(numbers)
    if not left:
        return left
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == set_id)
        .order_by(result_chunks.c.chunk)
    )
    for object_key in keys:
        left.difference_update(cell.number for cell in await stored_cells(store, object_key))
        if not left:
            break
    return left


async def require_in_set(
    connection: AsyncConnection,
    store: ResultStore,
    set_id: uuid.UUID,
    sources: Sequence[ObjectId],
) -> None:
    regions = {found.number for found in sources if found.letter is Letter.REGION}
    cells = {found.number for found in sources if found.letter is Letter.CELL}
    missing = [
        *(
            ObjectId(Letter.REGION, number)
            for number in sorted(await missing_regions(connection, set_id, regions))
        ),
        *(
            ObjectId(Letter.CELL, number)
            for number in sorted(await missing_cells(connection, store, set_id, cells))
        ),
    ]
    if missing:
        raise UnknownObjectError(f"{missing[0].text(ascii=True)} is not in this result set")


async def require_ai_object(
    connection: AsyncConnection, store: ResultStore, row: Any, found: ObjectId
) -> None:
    if row.result_set_id is None:
        await check_exists(connection, row, found)
        return
    await require_in_set(connection, store, row.result_set_id, [found])
