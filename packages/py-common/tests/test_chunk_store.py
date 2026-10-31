import gzip
import uuid
from array import array
from typing import Any, cast

import pytest

from parfocal_common.cell_chunks import (
    UNCLASSIFIED,
    UNSURE,
    ChunkError,
    UnknownVersionError,
    decode,
    encode,
    field,
)
from parfocal_common.chunk_store import (
    GRID,
    Cell,
    ChunkEntry,
    build_cells,
    cells_in,
    chunk_of,
    read_chunk,
    read_summary,
    summary_of,
    write_cells,
)
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.result_store import MissingObjectError, ObjectResultStore
from parfocal_common.review_order import CellChunk

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
SET = uuid.UUID("00000000-0000-4000-8000-000000000003")
PREFIX = f"t/{TENANT}/s/{SLIDE}/results/{SET}/"


def square(x: float, y: float, half: float = 2.0) -> list[float]:
    return [x - half, y - half, x + half, y - half, x + half, y + half, x - half, y + half]


FULL = [
    Cell(42, square(100, 100), 0, 230, 0, 3, [200, 40, 15], 1, square(100, 100, 1)),
    Cell(7, square(2100, 50), 2, 90, UNSURE, 0, [10, 20, 225], None, None),
    Cell(19, square(300, 1900), UNCLASSIFIED, 12, UNSURE, 0, [85, 85, 85], 2, square(300, 1900, 1)),
    Cell(3, [2050.5, 4100.25], 1, 255, 0, 9, [0, 255, 0], 0, None),
]
PLAIN = [
    Cell(5, square(10, 10), 1, 40),
    Cell(6, square(4000, 10), 0, 200, UNSURE, 2),
]


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        try:
            return self.objects[object_key]
        except KeyError as error:
            raise MissingObjectError(object_key) from error

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


def by_number(cells: list[Cell]) -> list[Cell]:
    return sorted(cells, key=lambda cell: cell.number)


def every_cell(built: Any) -> list[Cell]:
    return by_number([cell for item in built.chunks for cell in cells_in(*chunk_of(item.data))])


def test_every_field_round_trips_through_the_chunks() -> None:
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    assert every_cell(built) == by_number(FULL)
    header, arrays = chunk_of(built.chunks[0].data)
    assert (header["version"], header["kind"], header["classes"]) == (1, "cells", 3)
    assert {"probs", "alt_class", "nucleus_offsets", "nucleus_points"} <= set(arrays)
    assert [item.data[:2] for item in built.chunks] == [b"\x1f\x8b"] * 3


def test_a_set_without_the_optional_fields_round_trips_and_leaves_them_out() -> None:
    built = build_cells(TENANT, SLIDE, SET, PLAIN, 2)
    assert every_cell(built) == by_number(PLAIN)
    for item in built.chunks:
        names = {entry["name"] for entry in chunk_of(item.data)[0]["fields"]}
        assert names == {"number", "offsets", "points", "class", "score", "flags", "region"}
    summary = summary_of(built.summary.data, PREFIX)
    assert "probs" not in summary.arrays
    assert "alt_class" not in summary.arrays


def test_cells_bin_into_grid_tiles_by_their_centre_in_reading_order() -> None:
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    tiles = [(entry.x, entry.y, entry.width, entry.height) for entry in built.entries]
    assert tiles == [(0, 0, GRID, GRID), (2048, 0, GRID, GRID), (2048, 4096, GRID, GRID)]
    assert [entry.object_key for entry in built.entries] == [
        f"{PREFIX}chunk-00000.pfc",
        f"{PREFIX}chunk-00001.pfc",
        f"{PREFIX}chunk-00002.pfc",
    ]
    assert built.summary.key == f"{PREFIX}summary.pfc"
    first = chunk_of(built.chunks[0].data)[0]
    assert (first["chunk"], first["tile"]) == (0, [0, 0, GRID, GRID])
    assert [cell.number for cell in cells_in(*chunk_of(built.chunks[0].data))] == [19, 42]


def test_the_summary_index_lists_each_chunk_with_its_counts() -> None:
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    first = built.entries[0]
    assert first == ChunkEntry(
        chunk=0,
        x=0,
        y=0,
        width=GRID,
        height=GRID,
        cell_count=2,
        vertex_count=8,
        first_number=19,
        last_number=42,
        class_counts=(1, 0, 0),
        unclassified=1,
        unsure=1,
        object_key=f"{PREFIX}chunk-00000.pfc",
    )
    summary = summary_of(built.summary.data, PREFIX)
    assert summary.entries == built.entries
    assert summary.header["grid"] == GRID
    assert [entry.cell_count for entry in summary.entries] == [2, 1, 1]
    assert [entry.vertex_count for entry in summary.entries] == [8, 4, 1]


def test_the_summary_rows_follow_the_cell_numbers_and_point_into_their_chunk() -> None:
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    summary = summary_of(built.summary.data, PREFIX)
    arrays = summary.arrays
    assert list(summary.numbers()) == [3, 7, 19, 42]
    assert list(arrays["chunk"]) == [2, 1, 0, 0]
    assert list(arrays["index"]) == [0, 0, 0, 1]
    assert list(zip(arrays["x"], arrays["y"], strict=True))[1] == (2100.0, 50.0)
    assert list(arrays["diagonal"]) == [0, 6, 6, 6]
    assert list(arrays["class"]) == [1, 2, UNCLASSIFIED, 0]
    assert list(arrays["flags"]) == [0, UNSURE, UNSURE, 0]
    assert list(arrays["probs"])[:6] == [0, 255, 0, 10, 20, 225]
    assert list(arrays["alt_class"]) == [0, UNCLASSIFIED, 2, 1]
    for row, number in enumerate(summary.numbers()):
        chunk = cells_in(*chunk_of(built.chunks[arrays["chunk"][row]].data))
        assert chunk[arrays["index"][row]].number == number


def test_a_summary_without_numbers_counts_from_one() -> None:
    summary = encode(
        {"version": 1, "kind": "cell-summary", "count": 2, "chunks": []},
        [
            field(name, kind, array(code, [0, 0]))
            for name, kind, code in [
                ("x", "f4", "f"),
                ("y", "f4", "f"),
                ("diagonal", "u2", "H"),
                ("class", "u1", "B"),
                ("score", "u1", "B"),
                ("flags", "u1", "B"),
                ("chunk", "u2", "H"),
                ("index", "u2", "H"),
            ]
        ],
    )
    assert list(summary_of(summary, PREFIX).numbers()) == [1, 2]


def test_the_writer_is_deterministic() -> None:
    once = build_cells(TENANT, SLIDE, SET, FULL, 3)
    again = build_cells(TENANT, SLIDE, SET, list(reversed(FULL)), 3)
    assert once == again


def test_review_order_reads_the_chunks_the_writer_makes() -> None:
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    chunk = CellChunk.of(*chunk_of(built.chunks[0].data))
    assert [chunk.numbers[index] for index in range(len(chunk))] == [19, 42]
    assert [chunk.certainty(index) for index in range(len(chunk))] == [None, 200]
    assert chunk.centre(1) == (100.0, 100.0)


@pytest.mark.parametrize(
    ("cell", "message"),
    [
        (Cell(0, square(1, 1)), "number is out of range"),
        (Cell(1, [1.0, 2.0, 3.0]), "whole x and y pairs"),
        (Cell(1, [1.0, float("nan")]), "not a number"),
        (Cell(1, square(1, 1), 3), "class 3 is not one of 3 classes"),
        (Cell(1, square(1, 1), alt_class=5), "alternative class 5"),
        (Cell(1, square(1, 1), score=256), "score and flags are bytes"),
        (Cell(1, square(1, 1), probs=[1, 2]), "probabilities are not 3 bytes"),
        (Cell(1, square(1, 1), nucleus=[1.0]), "nucleus needs whole x and y pairs"),
    ],
)
def test_a_cell_that_does_not_fit_the_schema_is_refused(cell: Cell, message: str) -> None:
    with pytest.raises(ChunkError, match=message):
        build_cells(TENANT, SLIDE, SET, [cell], 3)


def test_a_set_refuses_twice_the_same_number_and_probabilities_on_only_some_cells() -> None:
    with pytest.raises(ChunkError, match="appears twice"):
        build_cells(TENANT, SLIDE, SET, [PLAIN[0], PLAIN[0]], 2)
    with pytest.raises(ChunkError, match="every cell has probabilities or none"):
        build_cells(TENANT, SLIDE, SET, [FULL[0], Cell(8, square(5, 5))], 3)


def versioned(version: object) -> bytes:
    built = build_cells(TENANT, SLIDE, SET, PLAIN[:1], 2)
    header, arrays = decode(built.chunks[0].data)
    fields = [field(item["name"], item["type"], arrays[item["name"]]) for item in header["fields"]]
    header = {key: value for key, value in header.items() if key != "fields"}
    return gzip.compress(encode({**header, "version": version}, fields))


@pytest.mark.parametrize("version", [2, 0, None, "1", True])
def test_a_reader_refuses_a_version_it_does_not_know(version: object) -> None:
    with pytest.raises(UnknownVersionError, match="this reader knows only 1") as refused:
        chunk_of(versioned(version))
    assert refused.value.version == version


def test_a_reader_ignores_a_field_added_within_its_version() -> None:
    built = build_cells(TENANT, SLIDE, SET, PLAIN[:1], 2)
    header, arrays = decode(built.chunks[0].data)
    fields = [field(item["name"], item["type"], arrays[item["name"]]) for item in header["fields"]]
    fields.append(field("later", "u1", array("B", [9])))
    header = {key: value for key, value in header.items() if key != "fields"}
    assert cells_in(*chunk_of(encode(header, fields))) == PLAIN[:1]


def test_a_summary_is_not_a_chunk() -> None:
    built = build_cells(TENANT, SLIDE, SET, PLAIN, 2)
    with pytest.raises(ChunkError, match="not 'cells'"):
        chunk_of(built.summary.data)


async def test_written_chunks_read_back_from_the_store() -> None:
    store = MemoryStore()
    built = build_cells(TENANT, SLIDE, SET, FULL, 3)
    entries = await write_cells(store, built)
    assert sorted(store.objects) == sorted([*(e.object_key for e in entries), built.summary.key])
    found = [cell for entry in entries for cell in await read_chunk(store, entry.object_key)]
    assert by_number(found) == by_number(FULL)
    assert (await read_summary(store, PREFIX)).entries == entries
    with pytest.raises(MissingObjectError):
        await read_chunk(store, f"{PREFIX}chunk-00099.pfc")


class FakeStorage:
    def __init__(self, status: int) -> None:
        self.status = status
        self.sent: list[tuple[str, str | None]] = []

    async def get_object(self, key: str) -> bytes:
        raise StorageError(self.status, "NoSuchKey")

    async def put_object(
        self, key: str, body: bytes, content_type: str, *, content_encoding: str | None = None
    ) -> None:
        self.sent.append((content_type, content_encoding))


async def test_the_object_store_marks_gzip_and_names_a_missing_file() -> None:
    storage = FakeStorage(404)
    store = ObjectResultStore(cast("ObjectStore", storage))
    await store.put("a", gzip.compress(b"PFC1"))
    await store.put("b", b"PFC1")
    assert storage.sent == [
        ("application/octet-stream", "gzip"),
        ("application/octet-stream", None),
    ]
    with pytest.raises(MissingObjectError):
        await store.get("a")
    with pytest.raises(StorageError):
        await ObjectResultStore(cast("ObjectStore", FakeStorage(500))).get("a")
