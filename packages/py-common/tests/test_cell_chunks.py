from array import array
from typing import Any

import pytest

from parfocal_common.cell_chunks import (
    ChunkError,
    Field,
    decode,
    encode,
    field,
    problems_with,
)

TRIANGLE = [0.0, 0.0, 10.0, 0.0, 5.0, 8.0]


def cells(*, probs: bool = True, classes: int = 3, extra: list[Field] | None = None) -> bytes:
    fields = [
        field("number", "u4", array("I", [7, 9])),
        field("offsets", "u4", array("I", [0, 3, 6])),
        field("points", "f4", array("f", TRIANGLE * 2)),
        field("class", "u1", array("B", [0, 2])),
        field("score", "u1", array("B", [230, 120])),
        field("flags", "u1", array("B", [0, 1])),
        field("region", "u4", array("I", [2, 0])),
    ]
    if probs:
        fields.append(field("probs", "u1", array("B", [200, 30, 25, 10, 15, 230][: 2 * classes])))
    header: dict[str, Any] = {"version": 1, "kind": "cells", "count": 2, "classes": classes}
    return encode(header, fields + (extra or []))


def checked(data: bytes, *, from_run: bool) -> list[str]:
    header, arrays = decode(data)
    return problems_with(header, arrays, from_run=from_run)


def test_a_chunk_round_trips_with_aligned_typed_fields() -> None:
    data = cells()
    assert data[:4] == b"PFC1"
    header, arrays = decode(data)
    assert header["count"] == 2
    assert list(arrays["number"]) == [7, 9]
    assert list(arrays["points"]) == TRIANGLE * 2
    assert list(arrays["probs"]) == [200, 30, 25, 10, 15, 230]
    base = 8 + int.from_bytes(data[4:8], "little")
    assert base % 8 == 0
    assert all(item["offset"] % 8 == 0 for item in header["fields"])


def test_a_model_run_chunk_without_probabilities_fails_the_schema() -> None:
    assert checked(cells(), from_run=True) == []
    assert checked(cells(probs=False), from_run=True) == [
        "probabilities are missing, and a model run must write them"
    ]
    assert checked(cells(probs=False), from_run=False) == []


def test_probabilities_must_cover_every_cell_and_class() -> None:
    assert checked(cells(classes=2), from_run=True) == []
    header, arrays = decode(cells(classes=3))
    header["classes"] = 4
    assert problems_with(header, arrays, from_run=True) == [
        "probs has 6 values for 2 cells and 4 classes"
    ]


def test_missing_and_mistyped_fields_and_bad_lengths_are_named() -> None:
    header, arrays = decode(cells())
    broken = {name: values for name, values in arrays.items() if name != "region"}
    assert problems_with(header, broken, from_run=True) == ["region is missing"]
    header["count"] = 3
    found = problems_with(header, arrays, from_run=True)
    assert "number has 2 values for 3 cells" in found
    assert "offsets has 3 values for 3 cells" in found
    retyped = encode(
        {"version": 1, "kind": "cells", "count": 0, "classes": 1},
        [
            field("number", "u2", array("H")),
            field("offsets", "u4", array("I", [0])),
            field("points", "f4", array("f")),
            field("class", "u1", array("B")),
            field("score", "u1", array("B")),
            field("flags", "u1", array("B")),
            field("region", "u4", array("I")),
            field("probs", "u2", array("H")),
        ],
    )
    assert checked(retyped, from_run=False) == ["number is u2, not u4", "probs is u2, not u1"]


def test_the_summary_checks_its_own_fields() -> None:
    summary = encode(
        {"version": 1, "kind": "cell-summary", "count": 1},
        [
            field("x", "f4", array("f", [1.5])),
            field("y", "f4", array("f", [2.5])),
            field("diagonal", "u2", array("H", [12])),
            field("class", "u1", array("B", [1])),
            field("score", "u1", array("B", [99])),
            field("flags", "u1", array("B", [0])),
            field("chunk", "u2", array("H", [0])),
            field("index", "u2", array("H", [0])),
        ],
    )
    assert checked(summary, from_run=True) == []


@pytest.mark.parametrize("data", [b"nope", b"PFC1" + (5).to_bytes(4, "little") + b"{bad}"])
def test_garbage_is_refused(data: bytes) -> None:
    with pytest.raises(ChunkError):
        decode(data)


def test_a_field_must_hold_whole_values() -> None:
    with pytest.raises(ChunkError):
        field("number", "u4", b"\x01\x02\x03")
    with pytest.raises(ChunkError):
        field("number", "u8", b"")
