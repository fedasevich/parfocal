import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import result_chunks, result_sets, review_task_slides
from parfocal_api.training_examples import TrainingExample, examples_of, tenant_decisions
from parfocal_common.chunk_store import Cell, read_chunk
from parfocal_common.model_runs import model_runs
from parfocal_common.result_store import ResultStore

PROBABILITY_SCALE = 255
CELL = "cell"


@dataclass(frozen=True)
class ReviewedNucleusRow:
    slide: str
    task: str
    kind: str
    number: int
    reviewer: str
    final_class: str | None
    rejected: bool
    outline: tuple[float, ...]
    reshaped: bool
    views: int
    probabilities: tuple[float, ...] | None

    def described(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TaskSet:
    result_set_id: uuid.UUID
    views: int


def flat_ring(geometry: dict[str, Any] | None) -> tuple[float, ...]:
    if geometry is None or geometry.get("type") != "Polygon":
        return ()
    rings: list[list[list[float]]] = geometry.get("coordinates") or []
    if not rings:
        return ()
    points = rings[0]
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    return tuple(float(value) for point in points for value in point[:2])


async def task_sets(
    connection: AsyncConnection, pairs: set[tuple[uuid.UUID, uuid.UUID]]
) -> dict[tuple[uuid.UUID, uuid.UUID], TaskSet]:
    if not pairs:
        return {}
    rows = await connection.execute(
        select(
            review_task_slides.c.task_id,
            review_task_slides.c.slide_id,
            review_task_slides.c.result_set_id,
            model_runs.c.test_time_views,
        )
        .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
        .outerjoin(model_runs, model_runs.c.job_id == result_sets.c.job_id)
        .where(review_task_slides.c.task_id.in_({task for task, _ in pairs}))
    )
    return {
        (row.task_id, row.slide_id): TaskSet(row.result_set_id, row.test_time_views or 1)
        for row in rows
        if (row.task_id, row.slide_id) in pairs
    }


async def set_cells(
    connection: AsyncConnection, store: ResultStore, result_set_id: uuid.UUID
) -> dict[int, Cell]:
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == result_set_id)
        .order_by(result_chunks.c.chunk)
    )
    found: dict[int, Cell] = {}
    for key in list(keys):
        for cell in await read_chunk(store, key):
            found[int(cell.number)] = cell
    return found


def row_of(example: TrainingExample, cell: Cell | None, task_set: TaskSet) -> ReviewedNucleusRow:
    reshaped = flat_ring(example.geometry)
    outline = reshaped or (() if cell is None else tuple(float(value) for value in cell.ring))
    probabilities = (
        None
        if cell is None or cell.probs is None
        else tuple(value / PROBABILITY_SCALE for value in cell.probs)
    )
    return ReviewedNucleusRow(
        slide=str(example.slide_id),
        task=str(example.task_id),
        kind=example.kind,
        number=example.number,
        reviewer=str(example.reviewer_id),
        final_class=None if example.final_class_id is None else str(example.final_class_id),
        rejected=example.rejected,
        outline=outline,
        reshaped=bool(reshaped),
        views=task_set.views,
        probabilities=probabilities,
    )


async def reviewed_nuclei(
    connection: AsyncConnection, store: ResultStore, tenant_id: uuid.UUID
) -> list[ReviewedNucleusRow]:
    examples = [
        example
        for example in examples_of(await tenant_decisions(connection, tenant_id))
        if example.kind == CELL
    ]
    pairs = {(example.task_id, example.slide_id) for example in examples}
    sets = await task_sets(connection, pairs)
    cells: dict[uuid.UUID, dict[int, Cell]] = {}
    found: list[ReviewedNucleusRow] = []
    for example in examples:
        task_set = sets.get((example.task_id, example.slide_id))
        if task_set is None:
            continue
        if task_set.result_set_id not in cells:
            cells[task_set.result_set_id] = await set_cells(
                connection, store, task_set.result_set_id
            )
        found.append(row_of(example, cells[task_set.result_set_id].get(example.number), task_set))
    return found


def described(rows: Sequence[ReviewedNucleusRow]) -> list[dict[str, Any]]:
    return [row.described() for row in rows]
