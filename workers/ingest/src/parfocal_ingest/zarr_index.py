import itertools
import json
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from parfocal_ingest.tile_index import VERSION

type Runs = list[list[int]]

DEFAULT_AXES = ("t", "c", "z", "y", "x")
SHARDING = "sharding_indexed"
INDEX_ENTRY_BYTES = 16
CHECKSUM_BYTES = 4
EMPTY_ENTRY = 2**64 - 1


class UnsupportedZarrError(ValueError):
    pass


@dataclass(frozen=True)
class ShardLayout:
    per_shard: tuple[int, ...]
    index_at_end: bool
    index_bytes: int


@dataclass(frozen=True)
class ArrayLayout:
    shape: tuple[int, ...]
    chunks: tuple[int, ...]
    prefix: tuple[str, ...]
    separator: str
    shard: ShardLayout | None = None


def absent_runs(absent: Sequence[bool]) -> Runs:
    runs: Runs = []
    for value, group in itertools.groupby(enumerate(absent), key=lambda item: item[1]):
        if not value:
            continue
        members = list(group)
        runs.append([members[0][0], len(members)])
    return runs


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise UnsupportedZarrError(f"{path.name} is not a JSON object")
    return value


def group_attributes(root: Path) -> tuple[int, dict[str, Any]]:
    if (root / "zarr.json").exists():
        attributes = read_json(root / "zarr.json").get("attributes") or {}
        return 3, attributes.get("ome") or attributes
    if (root / ".zgroup").exists():
        attributes = read_json(root / ".zattrs") if (root / ".zattrs").exists() else {}
        return 2, attributes
    raise UnsupportedZarrError("the store has no group metadata")


def array_layout(folder: Path, version: int) -> ArrayLayout:
    if version == 2:
        meta = read_json(folder / ".zarray")
        return ArrayLayout(
            tuple(meta["shape"]),
            tuple(meta["chunks"]),
            (),
            meta.get("dimension_separator") or ".",
        )
    meta = read_json(folder / "zarr.json")
    codecs: list[dict[str, Any]] = meta.get("codecs") or []
    sharding = next((codec for codec in codecs if codec.get("name") == SHARDING), None)
    encoding: dict[str, Any] = meta.get("chunk_key_encoding") or {"name": "default"}
    configuration: dict[str, Any] = encoding.get("configuration") or {}
    separator = configuration.get("separator")
    shape = tuple(meta["shape"])
    chunks = tuple(meta["chunk_grid"]["configuration"]["chunk_shape"])
    shard = None
    if sharding is not None:
        shard, chunks = shard_layout(sharding.get("configuration") or {}, chunks)
    if encoding.get("name") == "v2":
        return ArrayLayout(shape, chunks, (), separator or ".", shard)
    return ArrayLayout(shape, chunks, ("c",), separator or "/", shard)


def shard_layout(
    configuration: dict[str, Any], shard_shape: tuple[int, ...]
) -> tuple[ShardLayout, tuple[int, ...]]:
    inner = tuple(configuration.get("chunk_shape") or ())
    if len(inner) != len(shard_shape) or any(
        size < 1 or whole % size for whole, size in zip(shard_shape, inner, strict=True)
    ):
        raise UnsupportedZarrError("the shard shape is not a whole number of inner chunks")
    names = [codec.get("name") for codec in configuration.get("index_codecs") or ()]
    if names not in (["bytes"], ["bytes", "crc32c"]):
        raise UnsupportedZarrError(f"the shard index codecs {names} are not read")
    index_codecs: list[dict[str, Any]] = configuration["index_codecs"]
    if (index_codecs[0].get("configuration") or {}).get("endian", "little") != "little":
        raise UnsupportedZarrError("a big-endian shard index is not read")
    per_shard = tuple(whole // size for whole, size in zip(shard_shape, inner, strict=True))
    entries = 1
    for count in per_shard:
        entries *= count
    index_bytes = entries * INDEX_ENTRY_BYTES + (CHECKSUM_BYTES if "crc32c" in names else 0)
    location = configuration.get("index_location", "end")
    if location not in ("start", "end"):
        raise UnsupportedZarrError(f"the shard index location {location} is not read")
    return ShardLayout(per_shard, location == "end", index_bytes), inner


def shard_index(path: Path, shard: ShardLayout) -> tuple[int, ...] | None:
    if not path.exists():
        return None
    with path.open("rb") as file:
        if shard.index_at_end:
            if path.stat().st_size < shard.index_bytes:
                raise UnsupportedZarrError(f"the shard {path.name} is shorter than its index")
            file.seek(-shard.index_bytes, 2)
        data = file.read(shard.index_bytes)
    count = len(data) // INDEX_ENTRY_BYTES * 2
    if len(data) != shard.index_bytes:
        raise UnsupportedZarrError(f"the shard {path.name} is shorter than its index")
    return struct.unpack_from(f"<{count}Q", data)


def stored_in_shard(
    folder: Path,
    layout: ArrayLayout,
    shard: ShardLayout,
    key: Sequence[int],
    indexes: dict[Path, tuple[int, ...] | None],
) -> bool:
    path = chunk_path(
        folder, layout, [part // count for part, count in zip(key, shard.per_shard, strict=True)]
    )
    if path not in indexes:
        indexes[path] = shard_index(path, shard)
    index = indexes[path]
    if index is None:
        return False
    entry = 0
    for part, count in zip(key, shard.per_shard, strict=True):
        entry = entry * count + part % count
    return index[entry * 2] != EMPTY_ENTRY or index[entry * 2 + 1] != EMPTY_ENTRY


def chunk_path(folder: Path, layout: ArrayLayout, key: Sequence[int]) -> Path:
    parts = [str(part) for part in key]
    if layout.separator == "/":
        return folder.joinpath(*layout.prefix, *parts)
    return folder.joinpath(*layout.prefix, layout.separator.join(parts))


def axis_names(multiscale: dict[str, Any]) -> list[str]:
    axes = multiscale.get("axes") or DEFAULT_AXES
    return [axis if isinstance(axis, str) else axis["name"] for axis in axes]


def level_absence(folder: Path, layout: ArrayLayout, names: Sequence[str]) -> Runs:
    y, x = names.index("y"), names.index("x")
    grid = [-(-size // chunk) for size, chunk in zip(layout.shape, layout.chunks, strict=True)]
    read = [range(grid[axis]) if name == "c" else range(1) for axis, name in enumerate(names)]
    rows, columns = grid[y], grid[x]
    absent: list[bool] = []
    indexes: dict[Path, tuple[int, ...] | None] = {}
    shard = layout.shard

    def stored(key: Sequence[int]) -> bool:
        if shard is None:
            return chunk_path(folder, layout, key).exists()
        return stored_in_shard(folder, layout, shard, key, indexes)

    for row in range(rows):
        for column in range(columns):
            read[y], read[x] = range(row, row + 1), range(column, column + 1)
            absent.append(not any(stored(key) for key in itertools.product(*read)))
    return absent_runs(absent)


def zarr_tile_index(root: Path) -> dict[str, Any]:
    version, attributes = group_attributes(root)
    multiscales = attributes.get("multiscales") or []
    if not multiscales:
        raise UnsupportedZarrError("the store has no OME multiscales metadata")
    multiscale = multiscales[0]
    names = axis_names(multiscale)
    if "y" not in names or "x" not in names:
        raise UnsupportedZarrError("the axes have no y and x")
    levels: list[dict[str, Any]] = []
    base_width: int | None = None
    for dataset in multiscale["datasets"]:
        folder = root / dataset["path"]
        layout = array_layout(folder, version)
        height, width = layout.shape[names.index("y")], layout.shape[names.index("x")]
        base_width = base_width or width
        levels.append(
            {
                "path": dataset["path"],
                "downsample": base_width / width,
                "width": width,
                "height": height,
                "tileWidth": layout.chunks[names.index("x")],
                "tileHeight": layout.chunks[names.index("y")],
                "absentTiles": level_absence(folder, layout, names),
            }
        )
    return {
        "version": VERSION,
        "formatId": "ome-zarr",
        "tileKind": "grid",
        "zarrVersion": version,
        "levels": levels,
    }
