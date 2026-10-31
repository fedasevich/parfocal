import gzip
import os
import time
from array import array
from collections.abc import Sequence

import pytest

from parfocal_common.cell_chunks import encode, field
from parfocal_common.object_ids import Letter
from parfocal_common.review_order import (
    CellChunk,
    CellPool,
    least_sure_first,
    pack,
    scoped_cells,
    unpack,
)
from parfocal_common.scope import Scope, ScopeKind, in_scope

type Cell = tuple[int, int, int, float, float]

LARGE_CELLS = int(os.environ.get("REVIEW_ORDER_CELLS", "200000"))
PER_CHUNK = 2000


def chunk_bytes(
    cells: Sequence[Cell], probs: Sequence[int] | None, classes: int = 2, packed: bool = True
) -> bytes:
    ring: list[float] = []
    for _, _, _, x, y in cells:
        ring += [x - 1, y - 1, x + 1, y - 1, x + 1, y + 1, x - 1, y + 1]
    fields = [
        field("number", "u4", array("I", [cell[0] for cell in cells])),
        field("offsets", "u4", array("I", range(0, 4 * len(cells) + 1, 4))),
        field("points", "f4", array("f", ring)),
        field("class", "u1", array("B", [cell[1] for cell in cells])),
        field("score", "u1", array("B", [cell[2] for cell in cells])),
        field("flags", "u1", array("B", [0] * len(cells))),
        field("region", "u4", array("I", [0] * len(cells))),
    ]
    if probs is not None:
        fields.append(field("probs", "u1", array("B", probs)))
    header = {"version": 1, "kind": "cells", "count": len(cells), "classes": classes}
    data = encode(header, fields)
    return gzip.compress(data) if packed else data


TYPED = chunk_bytes(
    [(1, 0, 40, 10, 10), (2, 1, 250, 30, 10), (3, 255, 90, 50, 50), (4, 1, 10, 70, 70)],
    [200, 55, 30, 225, 120, 135, 100, 155],
)
UNTYPED = chunk_bytes([(5, 0, 20, 10, 90), (6, 1, 200, 90, 90)], None)


def cells(*keys: int) -> list[tuple[Letter, int]]:
    return [(Letter.CELL, number) for number in keys]


def test_a_cell_is_as_sure_as_the_probability_of_its_ai_class() -> None:
    typed = CellChunk.read(TYPED)
    assert [typed.certainty(index) for index in range(len(typed))] == [200, 225, None, 155]
    untyped = CellChunk.read(UNTYPED)
    assert [untyped.certainty(index) for index in range(len(untyped))] == [None, None]


def test_plain_and_gzipped_chunks_read_the_same() -> None:
    raw = chunk_bytes([(9, 1, 7, 4, 4)], [3, 250], packed=False)
    assert raw[:4] == b"PFC1"
    assert CellChunk.read(raw).certainty(0) == CellChunk.read(gzip.compress(raw)).certainty(0)


def test_a_cell_centre_is_the_mean_of_its_ring() -> None:
    chunk = CellChunk.read(TYPED)
    assert [chunk.centre(index) for index in range(2)] == [(10.0, 10.0), (30.0, 10.0)]


def test_cells_below_a_score_use_the_detection_score_not_the_certainty() -> None:
    scope = Scope(ScopeKind.CELLS_BELOW_SCORE, score=50)
    found = scoped_cells(scope, CellChunk.read(TYPED), "s")
    assert [(item.key, item.certainty) for item in found] == [
        ((Letter.CELL, 1), 200),
        ((Letter.CELL, 4), 155),
    ]


@pytest.mark.parametrize(
    ("kind", "flag"), [(ScopeKind.INSIDE_ROIS, "roi"), (ScopeKind.UNSURE_ZONES, "zone")]
)
def test_inside_scopes_keep_the_cells_found_inside(kind: ScopeKind, flag: str) -> None:
    inside = {2, 3}
    chunk = CellChunk.read(TYPED)
    found = (
        scoped_cells(Scope(kind), chunk, "s", inside_roi=inside)
        if flag == "roi"
        else scoped_cells(Scope(kind), chunk, "s", inside_zone=inside)
    )
    assert [item.key for item in found] == cells(2, 3)
    assert scoped_cells(Scope(kind), chunk, "s") == []


def test_the_pooled_sample_is_the_random_cells_scope() -> None:
    chunks = [CellChunk.read(TYPED), CellChunk.read(UNTYPED)]
    scope = Scope(ScopeKind.RANDOM_CELLS, count=3, seed=11)
    pool = CellPool()
    for chunk in chunks:
        pool.add(chunk)
    sampled = pool.sample(3, 11, "slide-a1")
    every = [candidate for chunk in chunks for candidate in chunk.candidates()]
    assert [item.key for item in sampled] == in_scope(scope, every, "slide-a1")
    certainty = {1: 200, 2: 225, 3: None, 4: 155, 5: None, 6: None}
    assert all(item.certainty == certainty[item.key[1]] for item in sampled)


def test_a_mixed_set_puts_unscored_cells_after_the_scored_ones() -> None:
    pool = CellPool()
    for data in (TYPED, UNTYPED):
        pool.add(CellChunk.read(data))
    order = least_sure_first(pool.sample(6, 1, "s"), 5, "s")
    assert order[:3] == cells(4, 1, 2)
    assert sorted(order[3:]) == cells(3, 5, 6)


def test_the_order_packs_into_five_bytes_per_object() -> None:
    keys = [(Letter.CELL, 4), (Letter.REGION, 2), (Letter.CELL, 4_000_000_000)]
    data = pack(keys)
    assert len(data) == 15
    assert unpack(data) == keys
    assert unpack(data[5:10]) == [(Letter.REGION, 2)]
    assert pack([]) == b""


def large_slide(total: int) -> list[bytes]:
    files: list[bytes] = []
    for first in range(1, total + 1, PER_CHUNK):
        numbers = range(first, min(first + PER_CHUNK, total + 1))
        files.append(
            chunk_bytes(
                [(n, n % 4, (n * 7) % 256, float(n % 2048), float(n // 2048)) for n in numbers],
                [(n * 13 + k) % 256 for n in numbers for k in range(4)],
                classes=4,
            )
        )
    return files


def test_a_large_slide_orders_within_a_sane_time_and_size() -> None:
    files = large_slide(LARGE_CELLS)
    started = time.perf_counter()
    pool = CellPool()
    for data in files:
        pool.add(CellChunk.read(data))
    sampled = pack(least_sure_first(pool.sample(200, 42, "large"), 42, "large"))
    random_seconds = time.perf_counter() - started
    started = time.perf_counter()
    scope = Scope(ScopeKind.CELLS_BELOW_SCORE, score=26)
    below = [item for data in files for item in scoped_cells(scope, CellChunk.read(data), "large")]
    packed = pack(least_sure_first(below, 42, "large"))
    below_seconds = time.perf_counter() - started
    print(
        f"cells={LARGE_CELLS} chunks={len(files)} chunk_bytes={sum(map(len, files))} "
        f"random_200_s={random_seconds:.3f} random_200_bytes={len(sampled)} "
        f"below_score_s={below_seconds:.3f} below_score_cells={len(below)} "
        f"below_score_bytes={len(packed)}"
    )
    assert len(sampled) == 200 * 5
    assert len(packed) == 5 * len(below)
    assert random_seconds < 0.1 * LARGE_CELLS / 1000
    assert below_seconds < 0.1 * LARGE_CELLS / 1000
