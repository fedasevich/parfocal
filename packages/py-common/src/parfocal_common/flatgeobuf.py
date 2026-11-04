import struct
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

MAGIC = b"fgb\x03fgb\x01"
SIZES = {"u8": 1, "bool": 1, "u16": 2, "u32": 4, "i32": 4, "u64": 8, "f64": 8}
FORMATS = {
    "u8": "<B",
    "bool": "<?",
    "u16": "<H",
    "u32": "<I",
    "i32": "<i",
    "u64": "<Q",
    "f64": "<d",
}
REFERENCE = 4


class GeometryType(IntEnum):
    UNKNOWN = 0
    POINT = 1
    LINE_STRING = 2
    POLYGON = 3
    MULTI_POINT = 4
    MULTI_LINE_STRING = 5
    MULTI_POLYGON = 6


class ColumnType(IntEnum):
    INT = 5
    DOUBLE = 10
    STRING = 11
    JSON = 12


class FlatGeobufError(ValueError):
    pass


@dataclass(frozen=True)
class Slot:
    index: int
    kind: str
    value: Any


@dataclass
class Table:
    slots: list[Slot] = field(default_factory=list[Slot])

    def put(self, index: int, kind: str, value: Any) -> Table:
        self.slots.append(Slot(index, kind, value))
        return self


def pad_to(out: bytearray, alignment: int, remainder: int = 0) -> None:
    while len(out) % alignment != remainder:
        out.append(0)


def write_string(out: bytearray, text: str) -> int:
    pad_to(out, 4)
    position = len(out)
    data = text.encode()
    out += struct.pack("<I", len(data)) + data + b"\0"
    return position


def write_vector(out: bytearray, kind: str, values: Sequence[Any]) -> int:
    size = SIZES[kind]
    pad_to(out, max(size, 4), (max(size, 4) - 4) % max(size, 4))
    position = len(out)
    out += struct.pack(f"<I{len(values)}{FORMATS[kind][1]}", len(values), *values)
    return position


def write_bytes(out: bytearray, data: bytes) -> int:
    pad_to(out, 4)
    position = len(out)
    out += struct.pack("<I", len(data)) + data
    return position


def write_tables(out: bytearray, tables: Sequence[Table]) -> int:
    pad_to(out, 4)
    position = len(out)
    out += struct.pack("<I", len(tables)) + bytes(4 * len(tables))
    for index, table in enumerate(tables):
        at = position + 4 + 4 * index
        struct.pack_into("<I", out, at, write_table(out, table) - at)
    return position


def write_child(out: bytearray, slot: Slot) -> int:
    match slot.kind:
        case "string":
            return write_string(out, slot.value)
        case "bytes":
            return write_bytes(out, slot.value)
        case "table":
            return write_table(out, slot.value)
        case "tables":
            return write_tables(out, slot.value)
        case _:
            return write_vector(out, slot.kind.removesuffix("s"), slot.value)


def write_table(out: bytearray, table: Table) -> int:
    ordered = sorted(table.slots, key=lambda slot: -SIZES.get(slot.kind, REFERENCE))
    offsets: dict[int, int] = {}
    cursor = 4
    for slot in ordered:
        size = SIZES.get(slot.kind, REFERENCE)
        cursor += -cursor % size
        offsets[slot.index] = cursor
        cursor += size
    inline = cursor + -cursor % 4
    count = max((slot.index for slot in table.slots), default=-1) + 1
    pad_to(out, 2)
    vtable = len(out)
    out += struct.pack(
        f"<HH{count}H", 4 + 2 * count, inline, *(offsets.get(i, 0) for i in range(count))
    )
    pad_to(out, 8)
    start = len(out)
    out += bytes(inline)
    struct.pack_into("<i", out, start, start - vtable)
    for slot in ordered:
        if slot.kind in FORMATS:
            struct.pack_into(FORMATS[slot.kind], out, start + offsets[slot.index], slot.value)
    for slot in ordered:
        if slot.kind not in FORMATS:
            at = start + offsets[slot.index]
            struct.pack_into("<I", out, at, write_child(out, slot) - at)
    return start


def finished(table: Table) -> bytes:
    out = bytearray(4)
    struct.pack_into("<I", out, 0, write_table(out, table))
    return struct.pack("<I", len(out)) + bytes(out)


def header(name: str, columns: Sequence[tuple[str, ColumnType]], count: int) -> bytes:
    described = [Table().put(0, "string", title).put(1, "u8", kind) for title, kind in columns]
    root = (
        Table()
        .put(0, "string", name)
        .put(2, "u8", GeometryType.UNKNOWN)
        .put(7, "tables", described)
        .put(8, "u64", count)
        .put(9, "u16", 0)
    )
    return MAGIC + finished(root)


def flat(points: Sequence[Sequence[float]]) -> list[float]:
    return [value for point in points for value in (float(point[0]), float(point[1]))]


def rings_table(kind: GeometryType, rings: Sequence[Sequence[Sequence[float]]]) -> Table:
    table = Table().put(1, "f64s", [v for ring in rings for v in flat(ring)]).put(6, "u8", kind)
    if len(rings) > 1:
        ends: list[int] = []
        for ring in rings:
            ends.append((ends[-1] if ends else 0) + len(ring))
        table.put(0, "u32s", ends)
    return table


def geometry_table(geometry: Mapping[str, Any]) -> Table:
    coordinates = geometry["coordinates"]
    match geometry["type"]:
        case "Point":
            return Table().put(1, "f64s", flat([coordinates])).put(6, "u8", GeometryType.POINT)
        case "LineString":
            return rings_table(GeometryType.LINE_STRING, [coordinates])
        case "MultiPoint":
            return Table().put(1, "f64s", flat(coordinates)).put(6, "u8", GeometryType.MULTI_POINT)
        case "Polygon":
            return rings_table(GeometryType.POLYGON, coordinates)
        case "MultiLineString":
            return rings_table(GeometryType.MULTI_LINE_STRING, coordinates)
        case "MultiPolygon":
            parts = [rings_table(GeometryType.POLYGON, polygon) for polygon in coordinates]
            return Table().put(6, "u8", GeometryType.MULTI_POLYGON).put(7, "tables", parts)
        case other:
            raise FlatGeobufError(f"FlatGeobuf export does not take {other}")


def encoded(kind: ColumnType, value: Any) -> bytes:
    match kind:
        case ColumnType.INT:
            return struct.pack("<i", value)
        case ColumnType.DOUBLE:
            return struct.pack("<d", value)
        case _:
            data = str(value).encode()
            return struct.pack("<I", len(data)) + data


def feature(
    geometry: Mapping[str, Any],
    columns: Sequence[tuple[str, ColumnType]],
    values: Mapping[str, Any],
) -> bytes:
    properties = b"".join(
        struct.pack("<H", index) + encoded(kind, values[name])
        for index, (name, kind) in enumerate(columns)
        if values.get(name) is not None
    )
    return finished(Table().put(0, "table", geometry_table(geometry)).put(1, "bytes", properties))


def frames(data: bytes) -> Iterator[bytes]:
    if data[:3] != MAGIC[:3] or data[3] != MAGIC[3]:
        raise FlatGeobufError("Not a FlatGeobuf file")
    position = len(MAGIC)
    while position < len(data):
        (size,) = struct.unpack_from("<I", data, position)
        yield data[position + 4 : position + 4 + size]
        position += 4 + size


def field_at(buffer: bytes, table: int, index: int) -> int | None:
    (back,) = struct.unpack_from("<i", buffer, table)
    vtable = table - back
    (length,) = struct.unpack_from("<H", buffer, vtable)
    if 4 + 2 * index >= length:
        return None
    (offset,) = struct.unpack_from("<H", buffer, vtable + 4 + 2 * index)
    return table + offset if offset else None


def root_of(buffer: bytes) -> int:
    return struct.unpack_from("<I", buffer, 0)[0]


def feature_count(header_buffer: bytes) -> int:
    at = field_at(header_buffer, root_of(header_buffer), 8)
    return 0 if at is None else struct.unpack_from("<Q", header_buffer, at)[0]


def geometry_type_of(feature_buffer: bytes) -> GeometryType:
    at = field_at(feature_buffer, root_of(feature_buffer), 0)
    if at is None:
        return GeometryType.UNKNOWN
    geometry = at + struct.unpack_from("<I", feature_buffer, at)[0]
    kind = field_at(feature_buffer, geometry, 6)
    return GeometryType(0 if kind is None else feature_buffer[kind])
