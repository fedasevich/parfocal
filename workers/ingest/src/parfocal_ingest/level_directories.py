import struct
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

NDPI_FORMAT = "hamamatsu-ndpi"


@dataclass(frozen=True)
class DirectoryLayout:
    count_format: str
    entry_bytes: int
    next_bytes: int

    @property
    def count_bytes(self) -> int:
        return struct.calcsize(self.count_format)

    def size(self, head: bytes) -> int:
        (count,) = struct.unpack(self.count_format, head[: self.count_bytes])
        return self.count_bytes + int(count) * self.entry_bytes + self.next_bytes


def layout_of(tiles: Mapping[str, Any]) -> DirectoryLayout:
    order = "<" if tiles.get("littleEndian", True) else ">"
    if tiles.get("bigTiff"):
        return DirectoryLayout(f"{order}Q", 20, 8)
    if tiles.get("formatId") == NDPI_FORMAT:
        return DirectoryLayout(f"{order}H", 12, 8)
    return DirectoryLayout(f"{order}H", 12, 4)


def pages_of(tiles: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for level in tiles.get("levels", []):
        yield level
        yield from level.get("siblings") or []


def directory_offsets(tiles: Mapping[str, Any]) -> list[int]:
    return sorted({int(page["ifdOffset"]) for page in pages_of(tiles)})


def handle_directory_sizes(handle: BinaryIO, tiles: Mapping[str, Any]) -> dict[int, int]:
    layout = layout_of(tiles)
    sizes: dict[int, int] = {}
    for offset in directory_offsets(tiles):
        handle.seek(offset)
        sizes[offset] = layout.size(handle.read(layout.count_bytes))
    return sizes


def directory_sizes(source: Path | BinaryIO, tiles: Mapping[str, Any]) -> dict[int, int]:
    if not isinstance(source, Path):
        return handle_directory_sizes(source, tiles)
    with source.open("rb") as handle:
        return handle_directory_sizes(handle, tiles)


def directory(page: Mapping[str, Any], sizes: Mapping[int, int]) -> dict[str, Any]:
    offset = int(page["ifdOffset"])
    entry = {"page": page["page"], "subIfd": page.get("subIfd"), "ifdOffset": offset}
    return entry if offset not in sizes else {**entry, "ifdBytes": sizes[offset]}


def located(
    table: dict[str, Any], tiles: Mapping[str, Any], sizes: Mapping[int, int]
) -> dict[str, Any]:
    levels = table.get("levels", [])
    indexed = tiles.get("levels", [])
    if len(levels) != len(indexed):
        return table
    return {
        **table,
        "levels": [
            {
                **level,
                **directory(entry, sizes),
                "siblings": [directory(page, sizes) for page in entry.get("siblings") or []],
            }
            for level, entry in zip(levels, indexed, strict=True)
        ],
    }


def is_located(table: Mapping[str, Any]) -> bool:
    levels = table.get("levels") or []
    return bool(levels) and all("ifdOffset" in level for level in levels)
