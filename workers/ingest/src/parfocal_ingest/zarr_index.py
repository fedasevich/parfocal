import itertools
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from parfocal_ingest.tile_index import VERSION

type Runs = list[list[int]]

DEFAULT_AXES = ("t", "c", "z", "y", "x")


class UnsupportedZarrError(ValueError):
    pass


@dataclass(frozen=True)
class ArrayLayout:
    shape: tuple[int, ...]
    chunks: tuple[int, ...]
    prefix: tuple[str, ...]
    separator: str


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
    if any(codec.get("name") == "sharding_indexed" for codec in meta.get("codecs") or ()):
        raise UnsupportedZarrError("sharded arrays wait for VIEW-017 (sharded OME-Zarr reading)")
    encoding: dict[str, Any] = meta.get("chunk_key_encoding") or {"name": "default"}
    configuration: dict[str, Any] = encoding.get("configuration") or {}
    separator = configuration.get("separator")
    shape = tuple(meta["shape"])
    chunks = tuple(meta["chunk_grid"]["configuration"]["chunk_shape"])
    if encoding.get("name") == "v2":
        return ArrayLayout(shape, chunks, (), separator or ".")
    return ArrayLayout(shape, chunks, ("c",), separator or "/")


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
    for row in range(rows):
        for column in range(columns):
            read[y], read[x] = range(row, row + 1), range(column, column + 1)
            absent.append(
                not any(
                    chunk_path(folder, layout, key).exists() for key in itertools.product(*read)
                )
            )
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
