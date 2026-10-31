import gzip
import json
import struct
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

MAGIC = b"PFC1"
GZIP_MAGIC = b"\x1f\x8b"
ALIGN = 8
VERSION = 1
SUPPORTED_VERSIONS = frozenset({VERSION})
SIZES = {"u1": 1, "u2": 2, "u4": 4, "f4": 4}
FORMATS: dict[str, Any] = {"u1": "B", "u2": "H", "u4": "I", "f4": "f"}
UNCLASSIFIED = 255
UNSURE = 1
CHUNK_FIELDS = {
    "number": "u4",
    "offsets": "u4",
    "points": "f4",
    "class": "u1",
    "score": "u1",
    "flags": "u1",
    "region": "u4",
}
OPTIONAL_FIELDS = {
    "probs": "u1",
    "alt_class": "u1",
    "nucleus_offsets": "u4",
    "nucleus_points": "f4",
}
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
OPTIONAL_SUMMARY_FIELDS = {"number": "u4", "probs": "u1", "alt_class": "u1"}
KINDS = {
    "cells": (CHUNK_FIELDS, OPTIONAL_FIELDS),
    "cell-summary": (SUMMARY_FIELDS, OPTIONAL_SUMMARY_FIELDS),
}
ONE_PER_CELL = {
    "cells": ("number", "class", "score", "flags", "region", "alt_class"),
    "cell-summary": (*SUMMARY_FIELDS, "number", "alt_class"),
}


class ChunkError(ValueError):
    pass


class UnknownVersionError(ChunkError):
    def __init__(self, version: object) -> None:
        known = ", ".join(str(item) for item in sorted(SUPPORTED_VERSIONS))
        super().__init__(
            f"This chunk has schema version {version!r}, and this reader knows only {known}"
        )
        self.version = version


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


def inflated(data: bytes) -> bytes:
    if data[:2] != GZIP_MAGIC:
        return data
    try:
        return gzip.decompress(data)
    except (OSError, EOFError) as error:
        raise ChunkError("The chunk is not valid gzip") from error


def decode(data: bytes) -> tuple[dict[str, Any], dict[str, memoryview]]:
    data = inflated(data)
    if data[:4] != MAGIC:
        raise ChunkError("This is not a Parfocal chunk")
    (length,) = struct.unpack("<I", data[4:8])
    try:
        parsed: Any = json.loads(data[8 : 8 + length])
    except ValueError as error:
        raise ChunkError("The chunk header is not JSON") from error
    if not isinstance(parsed, dict):
        raise ChunkError("The chunk header is not a JSON object")
    header = cast("dict[str, Any]", parsed)
    version: object = header.get("version")
    if isinstance(version, bool) or version not in SUPPORTED_VERSIONS:
        raise UnknownVersionError(version)
    base = 8 + length
    view = memoryview(data)
    arrays: dict[str, memoryview] = {}
    described: list[dict[str, Any]] = header.get("fields", [])
    for item in described:
        if item.get("type") not in SIZES:
            continue
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
    if kind not in KINDS:
        return [f"{kind!r} is not a chunk kind"]
    expected, optional = KINDS[kind]
    found: list[str] = []
    if header.get("version") not in SUPPORTED_VERSIONS:
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
    for name, kind_of in optional.items():
        if name in types and types[name] != kind_of:
            found.append(f"{name} is {types[name]}, not {kind_of}")
    found += [
        f"{name} has {len(arrays[name])} values for {count} cells"
        for name in ONE_PER_CELL[kind]
        if name in arrays and len(arrays[name]) != count
    ]
    if kind == "cells":
        found += ring_problems(arrays, count)
    return found + probability_problems(
        header, arrays, count, required=from_run and kind == "cells"
    )


def ring_lengths(
    arrays: Mapping[str, memoryview], count: int, offsets_name: str, points_name: str
) -> list[str]:
    offsets = arrays.get(offsets_name)
    if offsets is None:
        return []
    if len(offsets) != count + 1:
        return [f"{offsets_name} has {len(offsets)} values for {count} cells"]
    if points_name in arrays and offsets[-1] * 2 != len(arrays[points_name]):
        return [f"{offsets_name} do not end at the last point"]
    return []


def ring_problems(arrays: Mapping[str, memoryview], count: int) -> list[str]:
    found = ring_lengths(arrays, count, "offsets", "points")
    if ("nucleus_offsets" in arrays) != ("nucleus_points" in arrays):
        found.append("nucleus_offsets and nucleus_points come together")
    return found + ring_lengths(arrays, count, "nucleus_offsets", "nucleus_points")


def probability_problems(
    header: Mapping[str, Any], arrays: Mapping[str, memoryview], count: int, *, required: bool
) -> list[str]:
    classes = header.get("classes")
    probs = arrays.get("probs")
    if probs is None:
        return ["probabilities are missing, and a model run must write them"] if required else []
    if not isinstance(classes, int) or len(probs) != count * classes:
        return [f"probs has {len(probs)} values for {count} cells and {classes} classes"]
    return []
