import struct
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

NDPI_FORMAT = "hamamatsu-ndpi"
VALUE_BYTES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4}
VALUE_BYTES_BIG = {**VALUE_BYTES, 16: 8, 17: 8, 18: 8}
BITS_PER_SAMPLE = 258
TILE_OFFSETS = 324
TILE_BYTE_COUNTS = 325
EXTRA_SAMPLES = 338
SAMPLE_FORMAT = 339
JPEG_TABLES = 347
OPENING_TAGS = frozenset(
    {BITS_PER_SAMPLE, TILE_OFFSETS, TILE_BYTE_COUNTS, EXTRA_SAMPLES, SAMPLE_FORMAT, JPEG_TABLES}
)


@dataclass(frozen=True)
class DirectoryLayout:
    order: str
    count_format: str
    entry_bytes: int
    next_bytes: int
    big: bool
    ndpi: bool

    @property
    def count_bytes(self) -> int:
        return struct.calcsize(self.count_format)

    @property
    def inline_bytes(self) -> int:
        return 8 if self.big else 4

    def size(self, head: bytes) -> int:
        return self.count_bytes + self.entries(head) * self.entry_bytes + self.next_bytes

    def entries(self, head: bytes) -> int:
        (count,) = struct.unpack(self.count_format, head[: self.count_bytes])
        return int(count)

    def value_ranges(self, table: bytes) -> list[list[int]]:
        if self.ndpi:
            return []
        entry_format = f"{self.order}HHQQ" if self.big else f"{self.order}HHII"
        sizes = VALUE_BYTES_BIG if self.big else VALUE_BYTES
        ranges: list[list[int]] = []
        for index in range(self.entries(table)):
            at = self.count_bytes + index * self.entry_bytes
            tag, kind, count, offset = struct.unpack_from(entry_format, table, at)
            length = sizes.get(kind, 0) * count
            if tag in OPENING_TAGS and length > self.inline_bytes:
                ranges.append([int(tag), int(offset), int(length)])
        return ranges


@dataclass(frozen=True)
class Directory:
    size: int
    value_ranges: list[list[int]]


def layout_of(tiles: Mapping[str, Any]) -> DirectoryLayout:
    order = "<" if tiles.get("littleEndian", True) else ">"
    ndpi = tiles.get("formatId") == NDPI_FORMAT
    if tiles.get("bigTiff"):
        return DirectoryLayout(order, f"{order}Q", 20, 8, big=True, ndpi=False)
    return DirectoryLayout(order, f"{order}H", 12, 8 if ndpi else 4, big=False, ndpi=ndpi)


def pages_of(tiles: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for level in tiles.get("levels", []):
        yield level
        yield from level.get("siblings") or []


def directory_offsets(tiles: Mapping[str, Any]) -> list[int]:
    return sorted({int(page["ifdOffset"]) for page in pages_of(tiles)})


def directory_of(layout: DirectoryLayout, table: bytes) -> Directory:
    return Directory(layout.size(table), layout.value_ranges(table))


def handle_directories(handle: BinaryIO, tiles: Mapping[str, Any]) -> dict[int, Directory]:
    layout = layout_of(tiles)
    directories: dict[int, Directory] = {}
    for offset in directory_offsets(tiles):
        handle.seek(offset)
        size = layout.size(handle.read(layout.count_bytes))
        handle.seek(offset)
        directories[offset] = directory_of(layout, handle.read(size))
    return directories


def directories_in(source: Path | BinaryIO, tiles: Mapping[str, Any]) -> dict[int, Directory]:
    if not isinstance(source, Path):
        return handle_directories(source, tiles)
    with source.open("rb") as handle:
        return handle_directories(handle, tiles)


def directory(page: Mapping[str, Any], directories: Mapping[int, Directory]) -> dict[str, Any]:
    offset = int(page["ifdOffset"])
    entry = {"page": page["page"], "subIfd": page.get("subIfd"), "ifdOffset": offset}
    found = directories.get(offset)
    if found is None:
        return entry
    return {**entry, "ifdBytes": found.size, "valueRanges": found.value_ranges}


def header_of(tiles: Mapping[str, Any]) -> dict[str, bool]:
    return {
        "littleEndian": bool(tiles.get("littleEndian", True)),
        "bigTiff": bool(tiles.get("bigTiff", False)),
    }


def located(
    table: dict[str, Any], tiles: Mapping[str, Any], directories: Mapping[int, Directory]
) -> dict[str, Any]:
    levels = table.get("levels", [])
    indexed = tiles.get("levels", [])
    if len(levels) != len(indexed):
        return table
    return {
        **table,
        **header_of(tiles),
        "levels": [
            {
                **level,
                **directory(entry, directories),
                "siblings": [directory(page, directories) for page in entry.get("siblings") or []],
            }
            for level, entry in zip(levels, indexed, strict=True)
        ],
    }


def is_located(table: Mapping[str, Any]) -> bool:
    levels = table.get("levels") or []
    return bool(levels) and all("ifdOffset" in level for level in levels)


def is_current(table: Mapping[str, Any]) -> bool:
    return is_located(table) and "bigTiff" in table and "littleEndian" in table
