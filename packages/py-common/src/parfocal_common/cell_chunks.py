import json
import struct
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

MAGIC = b"PFC1"
ALIGN = 8
VERSION = 1
SIZES = {"u1": 1, "u2": 2, "u4": 4, "f4": 4}
FORMATS: dict[str, Any] = {"u1": "B", "u2": "H", "u4": "I", "f4": "f"}
CHUNK_FIELDS = {
    "number": "u4",
    "offsets": "u4",
    "points": "f4",
    "class": "u1",
    "score": "u1",
    "flags": "u1",
    "region": "u4",
}
OPTIONAL_FIELDS = {"probs": "u1", "nucleus_offsets": "u4", "nucleus_points": "f4"}
SUMMARY_FIELDS = {
    "x": "f4",
    "y": "f4",
    "diagonal": "u2",
    "class": "u1",
    "score": "u1",
    "flags": "u1",
    "chunk": "u2",
    "index": "u2",
}


class ChunkError(ValueError):
    pass


@dataclass(frozen=True)
class Field:
    name: str
    type: str
    data: bytes

    @property
    def length(self) -> int:
        return len(self.data) // SIZES[self.type]


def field(name: str, kind: str, values: Any) -> Field:
    if kind not in SIZES:
        raise ChunkError(f"{kind} is not a field type")
    data = bytes(memoryview(values).cast("B"))
    if len(data) % SIZES[kind]:
        raise ChunkError(f"{name} is not a whole number of {kind} values")
    return Field(name, kind, data)


def padded(length: int) -> int:
    return -length % ALIGN


def encode(header: Mapping[str, Any], fields: Sequence[Field]) -> bytes:
    if sys.byteorder != "little":
        raise ChunkError("Chunks are little-endian")
    body = bytearray()
    described: list[dict[str, Any]] = []
    for item in fields:
        body += b"\0" * padded(len(body))
        described.append(
            {"name": item.name, "type": item.type, "offset": len(body), "length": item.length}
        )
        body += item.data
    head = json.dumps({**header, "fields": described}, separators=(",", ":")).encode()
    head += b" " * padded(len(head) + len(MAGIC) + 4)
    return MAGIC + struct.pack("<I", len(head)) + head + bytes(body)


def decode(data: bytes) -> tuple[dict[str, Any], dict[str, memoryview]]:
    if data[:4] != MAGIC:
        raise ChunkError("This is not a Parfocal chunk")
    (length,) = struct.unpack("<I", data[4:8])
    try:
        header = json.loads(data[8 : 8 + length])
    except ValueError as error:
        raise ChunkError("The chunk header is not JSON") from error
    base = 8 + length
    view = memoryview(data)
    arrays: dict[str, memoryview] = {}
    for item in header.get("fields", []):
        start = base + item["offset"]
        end = start + item["length"] * SIZES[item["type"]]
        if end > len(data):
            raise ChunkError(f"{item['name']} runs past the end of the chunk")
        arrays[item["name"]] = view[start:end].cast(FORMATS[item["type"]])
    return header, arrays


def problems_with(
    header: Mapping[str, Any], arrays: Mapping[str, memoryview], *, from_run: bool
) -> list[str]:
    kind = header.get("kind")
    expected = SUMMARY_FIELDS if kind == "cell-summary" else CHUNK_FIELDS
    if kind not in {"cells", "cell-summary"}:
        return [f"{kind!r} is not a chunk kind"]
    found: list[str] = []
    if header.get("version") != VERSION:
        found.append(f"version {header.get('version')!r} is not {VERSION}")
    count = header.get("count")
    if not isinstance(count, int) or count < 0:
        return [*found, "count is missing"]
    types = {item["name"]: item["type"] for item in header.get("fields", [])}
    for name, kind_of in expected.items():
        if name not in arrays:
            found.append(f"{name} is missing")
        elif types[name] != kind_of:
            found.append(f"{name} is {types[name]}, not {kind_of}")
    for name, kind_of in OPTIONAL_FIELDS.items():
        if name in types and types[name] != kind_of:
            found.append(f"{name} is {types[name]}, not {kind_of}")
    if kind == "cells":
        found += cell_problems(header, arrays, count, from_run=from_run)
    else:
        found += [
            f"{name} has {len(arrays[name])} values for {count} cells"
            for name in SUMMARY_FIELDS
            if name in arrays and len(arrays[name]) != count
        ]
    return found


def cell_problems(
    header: Mapping[str, Any], arrays: Mapping[str, memoryview], count: int, *, from_run: bool
) -> list[str]:
    found: list[str] = []
    for name in ("number", "class", "score", "flags", "region"):
        if name in arrays and len(arrays[name]) != count:
            found.append(f"{name} has {len(arrays[name])} values for {count} cells")
    offsets = arrays.get("offsets")
    if offsets is not None:
        if len(offsets) != count + 1:
            found.append(f"offsets has {len(offsets)} values for {count} cells")
        elif "points" in arrays and offsets[-1] * 2 != len(arrays["points"]):
            found.append("offsets do not end at the last point")
    classes = header.get("classes")
    probs = arrays.get("probs")
    if probs is None:
        if from_run:
            found.append("probabilities are missing, and a model run must write them")
    elif not isinstance(classes, int) or len(probs) != count * classes:
        found.append(f"probs has {len(probs)} values for {count} cells and {classes} classes")
    return found
