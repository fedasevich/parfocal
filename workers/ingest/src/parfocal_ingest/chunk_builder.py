import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_common.cell_chunks import (
    UNCLASSIFIED,
    UNSURE,
    VERSION,
    ChunkError,
    Field,
    encode,
    field,
)
from parfocal_common.chunk_store import (
    GRID,
    MAX_CELLS_PER_CHUNK,
    MAX_CHUNKS,
    MAX_CLASSES,
    MAX_DIAGONAL,
    MAX_NUMBER,
    PARALLEL_PUTS,
    BuiltCells,
    Cell,
    ChunkEntry,
    StoredFile,
    chunk_key,
    packed,
    problem_of,
    summary_key,
)
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ResultStore

CHUNKS_PER_ROUND = 32
CELLS_PER_SLICE = 65_536


def per_cell(
    reduce: np.ufunc, points: NDArray[np.float32], offsets: NDArray[np.int64]
) -> NDArray[np.float64]:
    count = len(offsets) - 1
    found = np.zeros((max(count, 0), 2), dtype=np.float64)
    pairs = points.reshape(-1, 2)
    for first in range(0, count, CELLS_PER_SLICE):
        last = min(first + CELLS_PER_SLICE, count)
        start, end = int(offsets[first]), int(offsets[last])
        part = pairs[start:end].astype(np.float64)
        found[first:last] = reduce.reduceat(part, offsets[first:last] - start, axis=0)
    return found


def centres_of(points: NDArray[np.float32], offsets: NDArray[np.int64]) -> NDArray[np.float64]:
    return per_cell(np.add, points, offsets) / np.diff(offsets)[:, None]


@dataclass(frozen=True)
class CellTable:
    numbers: NDArray[np.int64]
    points: NDArray[np.float32]
    offsets: NDArray[np.int64]
    class_index: NDArray[np.uint8]
    score: NDArray[np.uint8]
    region: NDArray[np.int64]
    flags: NDArray[np.uint8] | None = None
    probs: NDArray[np.uint8] | None = None
    alt_class: NDArray[np.uint8] | None = None
    nucleus_points: NDArray[np.float32] | None = None
    nucleus_offsets: NDArray[np.int64] | None = None

    def __len__(self) -> int:
        return len(self.numbers)

    def flag_values(self) -> NDArray[np.uint8]:
        return np.zeros(len(self), dtype=np.uint8) if self.flags is None else self.flags

    def has_alt(self) -> bool:
        return self.alt_class is not None and bool((self.alt_class != UNCLASSIFIED).any())

    def has_nucleus(self) -> bool:
        return self.nucleus_offsets is not None and int(self.nucleus_offsets[-1]) > 0

    def cell(self, index: int) -> Cell:
        start, end = int(self.offsets[index]), int(self.offsets[index + 1])
        alt = None if self.alt_class is None else int(self.alt_class[index])
        nucleus = None
        if self.nucleus_offsets is not None and self.nucleus_points is not None:
            first, last = int(self.nucleus_offsets[index]), int(self.nucleus_offsets[index + 1])
            nucleus = self.nucleus_points[2 * first : 2 * last].tolist() or None
        return Cell(
            number=int(self.numbers[index]),
            ring=self.points[2 * start : 2 * end].tolist(),
            class_index=int(self.class_index[index]),
            score=int(self.score[index]),
            flags=int(self.flag_values()[index]),
            region=int(self.region[index]),
            probs=None if self.probs is None else self.probs[index].tolist(),
            alt_class=None if alt == UNCLASSIFIED else alt,
            nucleus=nucleus,
        )


def flat_rings(rings: Sequence[Sequence[float]]) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    lengths = np.fromiter((len(ring) // 2 for ring in rings), dtype=np.int64, count=len(rings))
    offsets = np.concatenate(([0], np.cumsum(lengths))).astype(np.int64)
    points = np.fromiter(
        (value for ring in rings for value in ring), dtype=np.float32, count=int(offsets[-1]) * 2
    )
    return points, offsets


def table_of_cells(cells: Sequence[Cell]) -> CellTable:
    points, offsets = flat_rings([cell.ring for cell in cells])
    nucleus_points, nucleus_offsets = flat_rings([cell.nucleus or () for cell in cells])
    probs = [cell.probs for cell in cells]
    if len({value is None for value in probs}) > 1:
        raise ChunkError("Either every cell has probabilities or none has")
    return CellTable(
        numbers=np.array([cell.number for cell in cells], dtype=np.int64),
        points=points,
        offsets=offsets,
        class_index=np.array([cell.class_index for cell in cells], dtype=np.uint8),
        score=np.array([cell.score for cell in cells], dtype=np.uint8),
        region=np.array([cell.region for cell in cells], dtype=np.int64),
        flags=np.array([cell.flags for cell in cells], dtype=np.uint8),
        probs=None
        if not cells or any(value is None for value in probs)
        else np.array(probs, dtype=np.uint8).reshape(len(cells), -1),
        alt_class=np.array(
            [UNCLASSIFIED if cell.alt_class is None else cell.alt_class for cell in cells],
            dtype=np.uint8,
        ),
        nucleus_points=nucleus_points,
        nucleus_offsets=nucleus_offsets,
    )


def first_true(mask: NDArray[np.bool_]) -> int | None:
    found = np.flatnonzero(mask)
    return int(found[0]) if len(found) else None


def first_not_finite(points: NDArray[np.float32], offsets: NDArray[np.int64]) -> int | None:
    count = len(offsets) - 1
    for first in range(0, count, CELLS_PER_SLICE):
        last = min(first + CELLS_PER_SLICE, count)
        start = int(offsets[first])
        part = points[2 * start : 2 * int(offsets[last])]
        found = first_true(~np.isfinite(part))
        if found is not None:
            return int(np.searchsorted(offsets, start + found // 2, side="right")) - 1
    return None


def first_problem(table: CellTable, classes: int) -> int | None:
    lengths = np.diff(table.offsets)
    not_finite = np.zeros(len(table), dtype=bool)
    found = first_not_finite(table.points, table.offsets)
    if found is not None:
        not_finite[found] = True
    bad = (
        (table.numbers <= 0)
        | (table.numbers > MAX_NUMBER)
        | (lengths < 1)
        | not_finite
        | ((table.class_index != UNCLASSIFIED) & (table.class_index >= classes))
        | (table.region < 0)
        | (table.region > MAX_NUMBER)
    )
    if table.alt_class is not None:
        bad |= (table.alt_class != UNCLASSIFIED) & (table.alt_class >= classes)
    if table.probs is not None and table.probs.shape[1] != classes:
        bad[:] = True
    return first_true(bad)


def first_repeat(numbers: NDArray[np.int64]) -> int | None:
    order = np.argsort(numbers, kind="stable")
    repeats = np.zeros(len(numbers), dtype=bool)
    repeats[order[1:][numbers[order][1:] == numbers[order][:-1]]] = True
    return first_true(repeats)


def check(table: CellTable, classes: int) -> None:
    problem = first_problem(table, classes)
    repeat = first_repeat(table.numbers)
    if repeat is not None and (problem is None or repeat < problem):
        raise ChunkError(f"Cell C{int(table.numbers[repeat])} appears twice")
    if problem is not None:
        cell = table.cell(problem)
        reason = problem_of(cell, classes) or f"its probabilities are not {classes} bytes"
        raise ChunkError(f"Cell C{cell.number} cannot be stored, because {reason}")


@dataclass(frozen=True)
class ChunkPlan:
    prefix: str
    classes: int
    grid: int
    order: NDArray[np.int64]
    starts: NDArray[np.int64]
    rows: NDArray[np.int64]
    columns: NDArray[np.int64]
    centres: NDArray[np.float64]
    diagonals: NDArray[np.uint16]

    def __len__(self) -> int:
        return len(self.rows)

    def members(self, chunk: int) -> NDArray[np.int64]:
        return self.order[self.starts[chunk] : self.starts[chunk + 1]]

    def tile(self, chunk: int) -> tuple[int, int, int, int]:
        return (
            int(self.columns[chunk]) * self.grid,
            int(self.rows[chunk]) * self.grid,
            self.grid,
            self.grid,
        )


def diagonals_of(points: NDArray[np.float32], offsets: NDArray[np.int64]) -> NDArray[np.uint16]:
    if len(offsets) <= 1:
        return np.zeros(0, dtype=np.uint16)
    spans = per_cell(np.maximum, points, offsets) - per_cell(np.minimum, points, offsets)
    return np.minimum(MAX_DIAGONAL, np.rint(np.hypot(spans[:, 0], spans[:, 1]))).astype(np.uint16)


def plan_chunks(
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    table: CellTable,
    classes: int,
    *,
    grid: int = GRID,
) -> ChunkPlan:
    if not 0 <= classes <= MAX_CLASSES:
        raise ChunkError(f"A result set has at most {MAX_CLASSES} classes")
    check(table, classes)
    centres = centres_of(table.points, table.offsets)
    rows = np.floor(centres[:, 1] / grid).astype(np.int64)
    columns = np.floor(centres[:, 0] / grid).astype(np.int64)
    order = np.lexsort((table.numbers, columns, rows))
    changed = np.ones(len(order), dtype=bool)
    if len(order):
        changed[1:] = (rows[order][1:] != rows[order][:-1]) | (
            columns[order][1:] != columns[order][:-1]
        )
    firsts = np.flatnonzero(changed)
    if len(firsts) > MAX_CHUNKS:
        raise ChunkError(f"A result set has at most {MAX_CHUNKS} chunks")
    starts = np.concatenate((firsts, [len(order)])).astype(np.int64)
    sizes = np.diff(starts)
    if len(sizes) and int(sizes.max()) > MAX_CELLS_PER_CHUNK:
        raise ChunkError(f"A chunk holds at most {MAX_CELLS_PER_CHUNK} cells")
    return ChunkPlan(
        prefix=result_set_prefix(tenant_id, slide_id, set_id),
        classes=classes,
        grid=grid,
        order=order,
        starts=starts,
        rows=rows[order][firsts],
        columns=columns[order][firsts],
        centres=centres,
        diagonals=diagonals_of(table.points, table.offsets),
    )


def gathered(
    points: NDArray[np.float32], offsets: NDArray[np.int64], members: NDArray[np.int64]
) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    firsts = offsets[members]
    lengths = offsets[members + 1] - firsts
    local = np.concatenate(([0], np.cumsum(lengths))).astype(np.int64)
    vertices = np.repeat(firsts - local[:-1], lengths) + np.arange(int(local[-1]))
    pairs = points.reshape(-1, 2)[vertices]
    return np.ascontiguousarray(pairs.reshape(-1)), local.astype(np.uint32)


def optional_fields(table: CellTable, members: NDArray[np.int64], *, nucleus: bool) -> list[Field]:
    fields: list[Field] = []
    if table.probs is not None:
        fields.append(field("probs", "u1", np.ascontiguousarray(table.probs[members]).reshape(-1)))
    if table.has_alt() and table.alt_class is not None:
        fields.append(field("alt_class", "u1", np.ascontiguousarray(table.alt_class[members])))
    if nucleus and table.nucleus_points is not None and table.nucleus_offsets is not None:
        points, offsets = gathered(table.nucleus_points, table.nucleus_offsets, members)
        fields += [field("nucleus_offsets", "u4", offsets), field("nucleus_points", "f4", points)]
    return fields


def entry_of(
    table: CellTable, plan: ChunkPlan, chunk: int, members: NDArray[np.int64], vertices: int
) -> ChunkEntry:
    classes = table.class_index[members]
    known = classes[classes != UNCLASSIFIED]
    counts = np.bincount(known, minlength=plan.classes)[: plan.classes].tolist()
    x, y, width, height = plan.tile(chunk)
    numbers = table.numbers[members]
    return ChunkEntry(
        chunk=chunk,
        x=x,
        y=y,
        width=width,
        height=height,
        cell_count=len(members),
        vertex_count=vertices,
        first_number=int(numbers[0]),
        last_number=int(numbers[-1]),
        class_counts=tuple(counts),
        unclassified=len(members) - len(known),
        unsure=int(np.count_nonzero(table.flag_values()[members] & UNSURE)),
        object_key=chunk_key(plan.prefix, chunk),
    )


def chunk_file(table: CellTable, plan: ChunkPlan, chunk: int) -> tuple[ChunkEntry, StoredFile]:
    members = plan.members(chunk)
    points, offsets = gathered(table.points, table.offsets, members)
    header: dict[str, Any] = {
        "version": VERSION,
        "kind": "cells",
        "count": len(members),
        "classes": plan.classes,
        "chunk": chunk,
        "tile": list(plan.tile(chunk)),
    }
    fields = [
        field("number", "u4", table.numbers[members].astype(np.uint32)),
        field("offsets", "u4", offsets),
        field("points", "f4", points),
        field("class", "u1", np.ascontiguousarray(table.class_index[members])),
        field("score", "u1", np.ascontiguousarray(table.score[members])),
        field("flags", "u1", np.ascontiguousarray(table.flag_values()[members])),
        field("region", "u4", table.region[members].astype(np.uint32)),
        *optional_fields(table, members, nucleus=table.has_nucleus()),
    ]
    entry = entry_of(table, plan, chunk, members, int(offsets[-1]))
    return entry, StoredFile(entry.object_key, packed(encode(header, fields)))


def summary_file(table: CellTable, plan: ChunkPlan, entries: Sequence[ChunkEntry]) -> StoredFile:
    chunk_of = np.repeat(np.arange(len(plan), dtype=np.uint16), np.diff(plan.starts))
    index_in_chunk = np.arange(len(plan.order)) - np.repeat(plan.starts[:-1], np.diff(plan.starts))
    by_number = plan.order[np.argsort(table.numbers[plan.order], kind="stable")]
    rank = np.empty(len(plan.order), dtype=np.int64)
    rank[plan.order] = np.arange(len(plan.order))
    rows = rank[by_number]
    header: dict[str, Any] = {
        "version": VERSION,
        "kind": "cell-summary",
        "count": len(by_number),
        "classes": plan.classes,
        "grid": plan.grid,
        "chunks": [entry.described() for entry in entries],
    }
    fields = [
        field("x", "f4", plan.centres[by_number, 0].astype(np.float32)),
        field("y", "f4", plan.centres[by_number, 1].astype(np.float32)),
        field("diagonal", "u2", np.ascontiguousarray(plan.diagonals[by_number])),
        field("class", "u1", np.ascontiguousarray(table.class_index[by_number])),
        field("score", "u1", np.ascontiguousarray(table.score[by_number])),
        field("flags", "u1", np.ascontiguousarray(table.flag_values()[by_number])),
        field("chunk", "u2", np.ascontiguousarray(chunk_of[rows])),
        field("index", "u2", index_in_chunk[rows].astype(np.uint16)),
        field("number", "u4", table.numbers[by_number].astype(np.uint32)),
        *optional_fields(table, by_number, nucleus=False),
    ]
    return StoredFile(summary_key(plan.prefix), packed(encode(header, fields)))


def build_table(table: CellTable, plan: ChunkPlan) -> BuiltCells:
    built = [chunk_file(table, plan, chunk) for chunk in range(len(plan))]
    entries = tuple(entry for entry, _ in built)
    return BuiltCells(
        plan.prefix, entries, tuple(item for _, item in built), summary_file(table, plan, entries)
    )


def chunk_round(
    table: CellTable, plan: ChunkPlan, chunks: range
) -> list[tuple[ChunkEntry, StoredFile]]:
    return [chunk_file(table, plan, chunk) for chunk in chunks]


async def write_table(
    store: ResultStore, table: CellTable, plan: ChunkPlan
) -> tuple[ChunkEntry, ...]:
    gate = asyncio.Semaphore(PARALLEL_PUTS)
    entries: list[ChunkEntry] = []

    async def put(item: StoredFile) -> None:
        async with gate:
            await store.put(item.key, item.data)

    for first in range(0, len(plan), CHUNKS_PER_ROUND):
        chunks = range(first, min(first + CHUNKS_PER_ROUND, len(plan)))
        built = await asyncio.to_thread(chunk_round, table, plan, chunks)
        async with asyncio.TaskGroup() as group:
            for entry, item in built:
                entries.append(entry)
                group.create_task(put(item))
    summary = await asyncio.to_thread(summary_file, table, plan, entries)
    await store.put(summary.key, summary.data)
    return tuple(entries)
