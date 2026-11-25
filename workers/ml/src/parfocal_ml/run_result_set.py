import asyncio
import uuid
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.cell_chunks import UNCLASSIFIED, ChunkError
from parfocal_common.chunk_store import (
    BuiltCells,
    Cell,
    build_cells,
    placed,
    read_chunk,
    read_summary,
    write_cells,
)
from parfocal_common.jobs import StepFailedError, StepFunction, StepRun
from parfocal_common.model_runs import MODEL_STAGE, STAGES, run_prefix, tile_key
from parfocal_common.object_ids import Letter
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import MissingObjectError, ResultStore
from parfocal_ml.cell_numbers import cell_distance, latest_per_number, pair_centres

NO_RESULT_SET = "run-result-set-missing"
TILE_MISSING = "run-tile-missing"
TILE_UNREADABLE = "run-tile-unreadable"
CELLS_UNSTORABLE = "run-cells-unstorable"
SET_CLOSED = "run-result-set-closed"
PROBABILITIES_DROPPED = "cell-probabilities-dropped"
NUMBERED = 0
MODEL_ORDINAL = STAGES.index(MODEL_STAGE)

RUN_SET = text(
    "SELECT result_sets.id, result_sets.slide_id, result_sets.status, slides.mpp_x, "
    "(SELECT count(*) FROM result_set_classes "
    "WHERE result_set_classes.result_set_id = result_sets.id) AS classes "
    "FROM result_sets JOIN slides ON slides.id = result_sets.slide_id "
    "WHERE result_sets.job_id = :job_id AND result_sets.deleted_at IS NULL"
)
LOCK_SET = text("SELECT status FROM result_sets WHERE id = :set_id FOR UPDATE")
TILE_UNITS = text(
    "SELECT unit FROM job_units WHERE job_id = :job_id AND ordinal = :ordinal ORDER BY unit"
)
UNIT_RESULT = text(
    "SELECT result FROM job_units WHERE job_id = :job_id AND ordinal = :ordinal AND unit = :unit"
)
CELL_SETS = text(
    "SELECT id FROM result_sets WHERE slide_id = :slide_id AND status = 'ready' "
    "AND deleted_at IS NULL AND cell_count > 0 ORDER BY created_at, id"
)
NEXT_NUMBERS = text(
    "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
    "VALUES (:tenant_id, :slide_id, :letter, :count) "
    "ON CONFLICT (slide_id, letter) DO UPDATE SET last = slide_counters.last + EXCLUDED.last "
    "RETURNING last"
)
ADD_CHUNK = text(
    "INSERT INTO result_chunks (tenant_id, result_set_id, chunk, x, y, width, height, "
    "cell_count, vertex_count, object_key) VALUES (:tenant_id, :result_set_id, :chunk, :x, :y, "
    ":width, :height, :cell_count, :vertex_count, :object_key)"
)
CHUNK_COUNT = text("SELECT count(*) FROM result_chunks WHERE result_set_id = :set_id")
REGIONS_BY_CLASS = text(
    "SELECT class_index, count(*) AS regions FROM result_objects "
    "WHERE result_set_id = :set_id AND kind = 'region' AND class_index IS NOT NULL "
    "GROUP BY class_index"
)
CLASS_OBJECTS = text(
    "UPDATE result_set_classes SET object_count = :objects "
    "WHERE result_set_id = :set_id AND position = :position"
)
READY = text(
    """
    UPDATE result_sets SET
      status = 'ready',
      cell_count = (
        SELECT coalesce(sum(cell_count), 0) FROM result_chunks
        WHERE result_chunks.result_set_id = result_sets.id
      ),
      region_count = (
        SELECT count(*) FROM result_objects
        WHERE result_objects.result_set_id = result_sets.id AND result_objects.kind = 'region'
      ),
      zone_count = (
        SELECT count(*) FROM result_objects
        WHERE result_objects.result_set_id = result_sets.id AND result_objects.kind = 'zone'
      )
    WHERE id = :set_id AND status = 'importing'
    RETURNING cell_count
    """
)


@dataclass(frozen=True)
class RunSet:
    id: uuid.UUID
    slide_id: uuid.UUID
    status: str
    mpp: float | None
    classes: int


async def run_set_of(connection: AsyncConnection, job_id: uuid.UUID) -> RunSet:
    row = (await connection.execute(RUN_SET, {"job_id": job_id})).one_or_none()
    if row is None:
        raise StepFailedError(NO_RESULT_SET)
    mpp = None if row.mpp_x is None else float(row.mpp_x)
    return RunSet(row.id, row.slide_id, str(row.status), mpp, int(row.classes))


def importing(found: RunSet) -> RunSet:
    if found.status != "importing":
        raise StepFailedError(SET_CLOSED)
    return found


async def run_cells(step: StepRun, store: ResultStore, prefix: str) -> list[Cell]:
    async with step.transaction() as connection:
        units = (
            await connection.scalars(TILE_UNITS, {"job_id": step.job_id, "ordinal": MODEL_ORDINAL})
        ).all()
    cells: list[Cell] = []
    for unit in units:
        try:
            cells += await read_chunk(store, tile_key(prefix, int(unit)))
        except MissingObjectError as error:
            raise StepFailedError(TILE_MISSING) from error
        except ChunkError as error:
            raise StepFailedError(TILE_UNREADABLE) from error
    return cells


def uniform(cells: Sequence[Cell]) -> tuple[list[Cell], bool]:
    with_probs = sum(cell.probs is not None for cell in cells)
    if 0 < with_probs < len(cells):
        return [replace(cell, probs=None) for cell in cells], True
    return list(cells), False


def centres_of(cells: Sequence[Cell]) -> NDArray[np.float64]:
    return np.array([placed(cell).centre for cell in cells], dtype=np.float64).reshape(-1, 2)


def nothing_known() -> tuple[NDArray[np.int64], NDArray[np.float64]]:
    return np.zeros(0, dtype=np.int64), np.zeros((0, 2), dtype=np.float64)


async def known_cells(
    step: StepRun, store: ResultStore, slide_id: uuid.UUID
) -> tuple[NDArray[np.int64], NDArray[np.float64]]:
    async with step.transaction() as connection:
        set_ids = (await connection.scalars(CELL_SETS, {"slide_id": slide_id})).all()
    numbers: list[NDArray[np.int64]] = []
    centres: list[NDArray[np.float64]] = []
    for set_id in set_ids:
        try:
            summary = await read_summary(store, result_set_prefix(step.tenant_id, slide_id, set_id))
        except MissingObjectError, ChunkError:
            continue
        numbers.append(np.asarray(summary.numbers(), dtype=np.int64))
        xs = np.asarray(summary.arrays["x"], dtype=np.float64)
        ys = np.asarray(summary.arrays["y"], dtype=np.float64)
        centres.append(np.column_stack((xs, ys)))
    if not numbers:
        return nothing_known()
    return latest_per_number(np.concatenate(numbers), np.concatenate(centres))


async def reserve(
    connection: AsyncConnection, tenant_id: uuid.UUID, slide_id: uuid.UUID, count: int
) -> int:
    last = await connection.scalar(
        NEXT_NUMBERS,
        {"tenant_id": tenant_id, "slide_id": slide_id, "letter": Letter.CELL.value, "count": count},
    )
    return int(last) - count + 1


async def unit_result(connection: AsyncConnection, step: StepRun) -> Mapping[str, Any] | None:
    stored = await connection.scalar(
        UNIT_RESULT, {"job_id": step.job_id, "ordinal": step.ordinal, "unit": NUMBERED}
    )
    return None if stored is None else dict(stored)


def built(
    tenant_id: uuid.UUID, run: RunSet, cells: Sequence[Cell], numbers: NDArray[np.int64]
) -> BuiltCells:
    numbered = [
        replace(cell, number=int(number)) for cell, number in zip(cells, numbers, strict=True)
    ]
    return build_cells(tenant_id, run.slide_id, run.id, numbered, run.classes)


def objects_placing(store: ResultStore) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        async with step.transaction() as connection:
            found = importing(await run_set_of(connection, step.job_id))
        prefix = run_prefix(step.tenant_id, found.slide_id, step.job_id)
        cells = await run_cells(step, store, prefix)
        classes = Counter(cell.class_index for cell in cells)
        return {
            "cells": len(cells),
            "typed": len(cells) - classes[UNCLASSIFIED],
            "result_set_id": str(found.id),
        }

    return run


def ids_giving(store: ResultStore) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        async with step.transaction() as connection:
            earlier = await unit_result(connection, step)
            found = await run_set_of(connection, step.job_id)
        if earlier is not None:
            return earlier
        importing(found)
        prefix = run_prefix(step.tenant_id, found.slide_id, step.job_id)
        cells, dropped = uniform(await run_cells(step, store, prefix))
        known_numbers, known_xy = (
            await known_cells(step, store, found.slide_id) if cells else nothing_known()
        )
        matching = await asyncio.to_thread(
            pair_centres,
            known_numbers,
            known_xy,
            await asyncio.to_thread(centres_of, cells),
            cell_distance(found.mpp),
        )
        async with step.transaction() as connection:
            await connection.execute(LOCK_SET, {"set_id": found.id})
            first = (
                await reserve(connection, step.tenant_id, found.slide_id, len(matching.new))
                if len(matching.new)
                else 0
            )
            try:
                files = await asyncio.to_thread(
                    built, step.tenant_id, found, cells, matching.numbers(first)
                )
            except ChunkError as error:
                raise StepFailedError(CELLS_UNSTORABLE) from error
            if cells:
                await write_cells(store, files)
                await add_rows(connection, step.tenant_id, found.id, files)
            result = {
                "cells": len(cells),
                "inherited": matching.inherited,
                "new": len(matching.new),
                "chunks": len(files.entries),
                **({"notice": PROBABILITIES_DROPPED} if dropped else {}),
            }
            await step.mark_unit(connection, NUMBERED, result)
        return result

    return run


async def add_rows(
    connection: AsyncConnection, tenant_id: uuid.UUID, set_id: uuid.UUID, files: BuiltCells
) -> None:
    if not files.entries:
        return
    await connection.execute(
        ADD_CHUNK,
        [
            {
                "tenant_id": tenant_id,
                "result_set_id": set_id,
                "chunk": entry.chunk,
                "x": entry.x,
                "y": entry.y,
                "width": entry.width,
                "height": entry.height,
                "cell_count": entry.cell_count,
                "vertex_count": entry.vertex_count,
                "object_key": entry.object_key,
            }
            for entry in files.entries
        ],
    )


async def cells_per_class(
    connection: AsyncConnection, store: ResultStore, step: StepRun, found: RunSet
) -> Counter[int]:
    counted: Counter[int] = Counter()
    if not await connection.scalar(CHUNK_COUNT, {"set_id": found.id}):
        return counted
    summary = await read_summary(store, result_set_prefix(step.tenant_id, found.slide_id, found.id))
    for entry in summary.entries:
        counted.update(dict(enumerate(entry.class_counts)))
    return counted


def result_set_adding(store: ResultStore) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        async with step.transaction() as connection:
            found = await run_set_of(connection, step.job_id)
            if found.status == "ready":
                return {"result_set_id": str(found.id), "status": found.status}
            importing(found)
            objects = await cells_per_class(connection, store, step, found)
            rows = await connection.execute(REGIONS_BY_CLASS, {"set_id": found.id})
            objects.update({int(row.class_index): int(row.regions) for row in rows})
            for position in range(found.classes):
                await connection.execute(
                    CLASS_OBJECTS,
                    {"set_id": found.id, "position": position, "objects": objects[position]},
                )
            cells = await connection.scalar(READY, {"set_id": found.id})
        return {"result_set_id": str(found.id), "status": "ready", "cells": int(cells or 0)}

    return run


def result_set_stages(store: ResultStore) -> dict[str, StepFunction]:
    return {
        "objects-placed": objects_placing(store),
        "ids-given": ids_giving(store),
        "result-set-added": result_set_adding(store),
    }
