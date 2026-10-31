import asyncio
import gzip
import math
import uuid
from array import array
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from parfocal_common.cell_chunks import (
    UNCLASSIFIED,
    UNSURE,
    VERSION,
    ChunkError,
    Field,
    decode,
    encode,
    field,
    problems_with,
)
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ResultStore

GRID = 2048
GZIP_LEVEL = 6
MAX_CLASSES = 255
MAX_CHUNKS = 65536
MAX_CELLS_PER_CHUNK = 65536
MAX_NUMBER = 2**32 - 1
MAX_DIAGONAL = 65535
PARALLEL_PUTS = 8
SUMMARY_NAME = "summary.pfc"

type Arrays = Mapping[str, memoryview]


def chunk_key(prefix: str, chunk: int) -> str:
    return f"{prefix}chunk-{chunk:05}.pfc"


def summary_key(prefix: str) -> str:
    return f"{prefix}{SUMMARY_NAME}"


@dataclass(frozen=True)
class Cell:
    number: int
    ring: Sequence[float]
    class_index: int = UNCLASSIFIED
    score: int = 0
    flags: int = 0
    region: int = 0
    probs: Sequence[int] | None = None
    alt_class: int | None = None
    nucleus: Sequence[float] | None = None


@dataclass(frozen=True)
class ChunkEntry:
    chunk: int
    x: int
    y: int
    width: int
    height: int
    cell_count: int
    vertex_count: int
    first_number: int
    last_number: int
    class_counts: tuple[int, ...]
    unclassified: int
    unsure: int
    object_key: str

    def described(self) -> dict[str, Any]:
        return {
            "chunk": self.chunk,
            "tile": [self.x, self.y, self.width, self.height],
            "count": self.cell_count,
            "vertices": self.vertex_count,
            "numbers": [self.first_number, self.last_number],
            "class_counts": list(self.class_counts),
            "unclassified": self.unclassified,
            "unsure": self.unsure,
        }

    @classmethod
    def read(cls, item: Mapping[str, Any], prefix: str) -> ChunkEntry:
        try:
            x, y, width, height = item["tile"]
            first, last = item["numbers"]
            return cls(
                chunk=int(item["chunk"]),
                x=int(x),
                y=int(y),
                width=int(width),
                height=int(height),
                cell_count=int(item["count"]),
                vertex_count=int(item["vertices"]),
                first_number=int(first),
                last_number=int(last),
                class_counts=tuple(int(count) for count in item["class_counts"]),
                unclassified=int(item["unclassified"]),
                unsure=int(item["unsure"]),
                object_key=chunk_key(prefix, int(item["chunk"])),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ChunkError("A chunk in the summary index is incomplete") from error


@dataclass(frozen=True)
class StoredFile:
    key: str
    data: bytes


@dataclass(frozen=True)
class BuiltCells:
    prefix: str
    entries: tuple[ChunkEntry, ...]
    chunks: tuple[StoredFile, ...]
    summary: StoredFile


@dataclass(frozen=True)
class Placed:
    cell: Cell
    ring: array[float]
    nucleus: array[float]
    centre: tuple[float, float]
    diagonal: int


@dataclass(frozen=True)
class SummaryRow:
    placed: Placed
    chunk: int
    index: int


def problem_of(cell: Cell, classes: int) -> str | None:
    in_class = range(classes)
    if not 0 < cell.number <= MAX_NUMBER:
        return "its number is out of range"
    if len(cell.ring) < 2 or len(cell.ring) % 2:
        return "its outline needs whole x and y pairs"
    if not all(math.isfinite(value) for value in cell.ring):
        return "its outline has a value that is not a number"
    if cell.nucleus is not None and (len(cell.nucleus) < 2 or len(cell.nucleus) % 2):
        return "its nucleus needs whole x and y pairs"
    if cell.class_index != UNCLASSIFIED and cell.class_index not in in_class:
        return f"its class {cell.class_index} is not one of {classes} classes"
    if cell.alt_class is not None and cell.alt_class not in in_class:
        return f"its alternative class {cell.alt_class} is not one of {classes} classes"
    if not (0 <= cell.score <= 255 and 0 <= cell.flags <= 255):
        return "its score and flags are bytes"
    if not 0 <= cell.region <= MAX_NUMBER:
        return "its region number is out of range"
    if cell.probs is not None and (
        len(cell.probs) != classes or not all(0 <= value <= 255 for value in cell.probs)
    ):
        return f"its probabilities are not {classes} bytes"
    return None


def placed(cell: Cell) -> Placed:
    ring = array("f", cell.ring)
    xs, ys = ring[0::2], ring[1::2]
    diagonal = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    return Placed(
        cell,
        ring,
        array("f", cell.nucleus or ()),
        (sum(xs) / len(xs), sum(ys) / len(ys)),
        min(MAX_DIAGONAL, round(diagonal)),
    )


def binned(cells: Iterable[Cell], classes: int, grid: int) -> dict[tuple[int, int], list[Placed]]:
    bins: dict[tuple[int, int], list[Placed]] = {}
    seen: set[int] = set()
    for cell in cells:
        problem = problem_of(cell, classes)
        if problem is not None:
            raise ChunkError(f"Cell C{cell.number} cannot be stored, because {problem}")
        if cell.number in seen:
            raise ChunkError(f"Cell C{cell.number} appears twice")
        seen.add(cell.number)
        item = placed(cell)
        x, y = item.centre
        bins.setdefault((math.floor(y / grid), math.floor(x / grid)), []).append(item)
    return bins


def packed(data: bytes) -> bytes:
    return gzip.compress(data, compresslevel=GZIP_LEVEL, mtime=0)


def optional_fields(
    members: Sequence[Placed], *, probs: bool, alt: bool, nucleus: bool
) -> list[Field]:
    fields: list[Field] = []
    if probs:
        fields.append(
            field("probs", "u1", array("B", [v for m in members for v in m.cell.probs or ()]))
        )
    if alt:
        values = [UNCLASSIFIED if m.cell.alt_class is None else m.cell.alt_class for m in members]
        fields.append(field("alt_class", "u1", array("B", values)))
    if nucleus:
        offsets = array("I", [0])
        points = array("f")
        for member in members:
            points.extend(member.nucleus)
            offsets.append(len(points) // 2)
        fields += [field("nucleus_offsets", "u4", offsets), field("nucleus_points", "f4", points)]
    return fields


def chunk_fields(members: Sequence[Placed]) -> list[Field]:
    offsets = array("I", [0])
    points = array("f")
    for member in members:
        points.extend(member.ring)
        offsets.append(len(points) // 2)
    return [
        field("number", "u4", array("I", [m.cell.number for m in members])),
        field("offsets", "u4", offsets),
        field("points", "f4", points),
        field("class", "u1", array("B", [m.cell.class_index for m in members])),
        field("score", "u1", array("B", [m.cell.score for m in members])),
        field("flags", "u1", array("B", [m.cell.flags for m in members])),
        field("region", "u4", array("I", [m.cell.region for m in members])),
    ]


def entry_of(
    chunk: int, tile: tuple[int, int, int, int], members: Sequence[Placed], classes: int, key: str
) -> ChunkEntry:
    counts = [0] * classes
    for member in members:
        if member.cell.class_index != UNCLASSIFIED:
            counts[member.cell.class_index] += 1
    return ChunkEntry(
        chunk=chunk,
        x=tile[0],
        y=tile[1],
        width=tile[2],
        height=tile[3],
        cell_count=len(members),
        vertex_count=sum(len(m.ring) // 2 for m in members),
        first_number=members[0].cell.number,
        last_number=members[-1].cell.number,
        class_counts=tuple(counts),
        unclassified=len(members) - sum(counts),
        unsure=sum(1 for m in members if m.cell.flags & UNSURE),
        object_key=key,
    )


def summary_fields(rows: Sequence[SummaryRow], *, probs: bool, alt: bool) -> list[Field]:
    members = [row.placed for row in rows]
    return [
        field("x", "f4", array("f", [m.centre[0] for m in members])),
        field("y", "f4", array("f", [m.centre[1] for m in members])),
        field("diagonal", "u2", array("H", [m.diagonal for m in members])),
        field("class", "u1", array("B", [m.cell.class_index for m in members])),
        field("score", "u1", array("B", [m.cell.score for m in members])),
        field("flags", "u1", array("B", [m.cell.flags for m in members])),
        field("chunk", "u2", array("H", [row.chunk for row in rows])),
        field("index", "u2", array("H", [row.index for row in rows])),
        field("number", "u4", array("I", [m.cell.number for m in members])),
        *optional_fields(members, probs=probs, alt=alt, nucleus=False),
    ]


def build_cells(
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    cells: Iterable[Cell],
    classes: int,
    *,
    grid: int = GRID,
) -> BuiltCells:
    if not 0 <= classes <= MAX_CLASSES:
        raise ChunkError(f"A result set has at most {MAX_CLASSES} classes")
    bins = binned(cells, classes, grid)
    everyone = [member for members in bins.values() for member in members]
    with_probs = {member.cell.probs is not None for member in everyone}
    if len(with_probs) > 1:
        raise ChunkError("Either every cell has probabilities or none has")
    probs = with_probs == {True}
    alt = any(member.cell.alt_class is not None for member in everyone)
    nucleus = any(member.cell.nucleus is not None for member in everyone)
    if len(bins) > MAX_CHUNKS:
        raise ChunkError(f"A result set has at most {MAX_CHUNKS} chunks")
    prefix = result_set_prefix(tenant_id, slide_id, set_id)
    entries: list[ChunkEntry] = []
    chunks: list[StoredFile] = []
    rows: list[SummaryRow] = []
    for index, (row, column) in enumerate(sorted(bins)):
        members = sorted(bins[(row, column)], key=lambda member: member.cell.number)
        if len(members) > MAX_CELLS_PER_CHUNK:
            raise ChunkError(f"A chunk holds at most {MAX_CELLS_PER_CHUNK} cells")
        tile = (column * grid, row * grid, grid, grid)
        key = chunk_key(prefix, index)
        entry = entry_of(index, tile, members, classes, key)
        header = {
            "version": VERSION,
            "kind": "cells",
            "count": len(members),
            "classes": classes,
            "chunk": index,
            "tile": list(tile),
        }
        fields = chunk_fields(members) + optional_fields(
            members, probs=probs, alt=alt, nucleus=nucleus
        )
        entries.append(entry)
        chunks.append(StoredFile(key, packed(encode(header, fields))))
        rows += [SummaryRow(member, index, position) for position, member in enumerate(members)]
    rows.sort(key=lambda item: item.placed.cell.number)
    header = {
        "version": VERSION,
        "kind": "cell-summary",
        "count": len(rows),
        "classes": classes,
        "grid": grid,
        "chunks": [entry.described() for entry in entries],
    }
    summary = encode(header, summary_fields(rows, probs=probs, alt=alt))
    return BuiltCells(
        prefix, tuple(entries), tuple(chunks), StoredFile(summary_key(prefix), packed(summary))
    )


async def write_cells(store: ResultStore, built: BuiltCells) -> tuple[ChunkEntry, ...]:
    gate = asyncio.Semaphore(PARALLEL_PUTS)

    async def put(item: StoredFile) -> None:
        async with gate:
            await store.put(item.key, item.data)

    async with asyncio.TaskGroup() as group:
        for item in built.chunks:
            group.create_task(put(item))
    await store.put(built.summary.key, built.summary.data)
    return built.entries


def checked(data: bytes, kind: str) -> tuple[dict[str, Any], dict[str, memoryview]]:
    header, arrays = decode(data)
    if header.get("kind") != kind:
        raise ChunkError(f"This is a {header.get('kind')!r} file, not {kind!r}")
    problems = problems_with(header, arrays, from_run=False)
    if problems:
        raise ChunkError("; ".join(problems))
    return header, arrays


def chunk_of(data: bytes) -> tuple[dict[str, Any], dict[str, memoryview]]:
    return checked(data, "cells")


def ring_of(offsets: memoryview, points: memoryview, index: int) -> list[float]:
    return list(points[2 * offsets[index] : 2 * offsets[index + 1]])


def cells_in(header: Mapping[str, Any], arrays: Arrays) -> list[Cell]:
    classes = int(header.get("classes") or 0)
    probs = arrays.get("probs")
    alt = arrays.get("alt_class")
    nucleus_offsets = arrays.get("nucleus_offsets")
    nucleus_points = arrays.get("nucleus_points")
    found: list[Cell] = []
    for index, number in enumerate(arrays["number"]):
        nucleus = (
            ring_of(nucleus_offsets, nucleus_points, index)
            if nucleus_offsets is not None and nucleus_points is not None
            else []
        )
        alt_class = UNCLASSIFIED if alt is None else alt[index]
        found.append(
            Cell(
                number=number,
                ring=ring_of(arrays["offsets"], arrays["points"], index),
                class_index=arrays["class"][index],
                score=arrays["score"][index],
                flags=arrays["flags"][index],
                region=arrays["region"][index],
                probs=None
                if probs is None
                else list(probs[index * classes : (index + 1) * classes]),
                alt_class=None if alt_class == UNCLASSIFIED else alt_class,
                nucleus=nucleus or None,
            )
        )
    return found


@dataclass(frozen=True)
class CellSummary:
    header: dict[str, Any]
    arrays: dict[str, memoryview]
    entries: tuple[ChunkEntry, ...]

    def __len__(self) -> int:
        return int(self.header["count"])

    def numbers(self) -> Sequence[int]:
        stored = self.arrays.get("number")
        return range(1, len(self) + 1) if stored is None else stored


def summary_of(data: bytes, prefix: str) -> CellSummary:
    header, arrays = checked(data, "cell-summary")
    entries = tuple(ChunkEntry.read(item, prefix) for item in header.get("chunks", []))
    return CellSummary(header, arrays, entries)


async def read_chunk(store: ResultStore, object_key: str) -> list[Cell]:
    header, arrays = chunk_of(await store.get(object_key))
    return cells_in(header, arrays)


async def read_summary(store: ResultStore, prefix: str) -> CellSummary:
    return summary_of(await store.get(summary_key(prefix)), prefix)
