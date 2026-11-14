import itertools
import json
import os
import struct
from collections.abc import Sequence
from pathlib import Path

import pytest

from parfocal_ingest.zarr_index import UnsupportedZarrError, absent_runs, zarr_tile_index

GOLDEN = Path(__file__).resolve().parent / "golden" / "tile-index" / "sparse-ome-zarr-0.4.json"

SYNTHETIC = Path(__file__).resolve().parents[3] / "packages" / "test-fixtures" / "synthetic"
EMPTY = 2**64 - 1

type Missing = Sequence[tuple[int, int, int]]


def put(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str):
        path.write_text(content)
    else:
        path.write_bytes(content)


def write_store(
    root: Path,
    version: int,
    missing: Missing,
    width: int = 100,
    height: int = 70,
    chunk: int = 32,
    levels: int = 2,
    missing_channels: Missing = (),
) -> Path:
    axes = [{"name": "c", "type": "channel"}, {"name": "y"}, {"name": "x"}]
    datasets = [{"path": str(level)} for level in range(levels)]
    attributes = {"multiscales": [{"axes": axes, "datasets": datasets}]}
    if version == 2:
        put(root / ".zgroup", json.dumps({"zarr_format": 2}))
        put(root / ".zattrs", json.dumps(attributes))
    else:
        group = {"zarr_format": 3, "node_type": "group", "attributes": {"ome": attributes}}
        put(root / "zarr.json", json.dumps(group))
    for level in range(levels):
        shape = [3, -(-height // 2**level), -(-width // 2**level)]
        folder = root / str(level)
        if version == 2:
            meta = {"zarr_format": 2, "shape": shape, "chunks": [1, chunk, chunk]}
            put(folder / ".zarray", json.dumps(meta | {"dimension_separator": "/"}))
        else:
            grid = {"name": "regular", "configuration": {"chunk_shape": [1, chunk, chunk]}}
            meta = {"zarr_format": 3, "node_type": "array", "shape": shape, "chunk_grid": grid}
            put(folder / "zarr.json", json.dumps(meta))
        for channel in range(3):
            for row in range(-(-shape[1] // chunk)):
                for column in range(-(-shape[2] // chunk)):
                    cell = (level, row, column)
                    if cell in missing or (cell in missing_channels and channel > 0):
                        continue
                    key = [str(channel), str(row), str(column)]
                    path = folder.joinpath(*key) if version == 2 else folder.joinpath("c", *key)
                    put(path, b"\x01")
    return root


def test_runs_cover_each_stretch_of_absent_tiles() -> None:
    assert absent_runs([False, True, True, False, True]) == [[1, 2], [4, 1]]
    assert absent_runs([False, False]) == []
    assert absent_runs([True, True, True]) == [[0, 3]]


@pytest.mark.parametrize("version", [2, 3])
def test_a_sparse_zarr_store_gets_an_absence_map_per_level(tmp_path: Path, version: int) -> None:
    root = write_store(
        tmp_path / "sparse.zarr", version, [(0, 0, 1), (0, 1, 0), (0, 1, 1), (1, 1, 1)]
    )
    document = zarr_tile_index(root)
    assert document["formatId"] == "ome-zarr"
    assert document["zarrVersion"] == version
    assert "micronsPerPixel" not in document
    first, second = document["levels"]
    assert (first["width"], first["height"], first["tileWidth"], first["downsample"]) == (
        100,
        70,
        32,
        1,
    )
    assert first["absentTiles"] == [[1, 1], [4, 2]]
    assert (second["width"], second["height"], second["downsample"]) == (50, 35, 2)
    assert second["absentTiles"] == [[3, 1]]


def test_the_committed_zarr_sidecar_is_what_the_writer_produces(tmp_path: Path) -> None:
    root = write_store(tmp_path / "sparse.zarr", 2, [(0, 0, 1)], width=300, height=200, chunk=128)
    written = json.dumps(zarr_tile_index(root), separators=(",", ":"))
    if os.environ.get("PARFOCAL_UPDATE_GOLDEN") == "1":
        GOLDEN.write_text(written)
    assert json.loads(GOLDEN.read_text()) == json.loads(written)


def test_a_tile_with_any_channel_stored_is_present(tmp_path: Path) -> None:
    root = write_store(tmp_path / "partial.zarr", 2, [], missing_channels=[(0, 0, 0)])
    assert zarr_tile_index(root)["levels"][0]["absentTiles"] == []


def write_sharded(
    root: Path,
    missing: Missing,
    location: str = "end",
    checksum: bool = True,
    without_shards: Sequence[tuple[int, int]] = (),
) -> Path:
    axes = [{"name": "c", "type": "channel"}, {"name": "y"}, {"name": "x"}]
    attributes = {"multiscales": [{"axes": axes, "datasets": [{"path": "0"}]}]}
    group = {"zarr_format": 3, "node_type": "group", "attributes": {"ome": attributes}}
    put(root / "zarr.json", json.dumps(group))
    index_codecs = [{"name": "bytes"}, *([{"name": "crc32c"}] if checksum else [])]
    sharding = {
        "name": "sharding_indexed",
        "configuration": {
            "chunk_shape": [3, 32, 32],
            "codecs": [{"name": "bytes"}],
            "index_codecs": index_codecs,
            "index_location": location,
        },
    }
    grid = {"name": "regular", "configuration": {"chunk_shape": [3, 64, 64]}}
    meta = {
        "zarr_format": 3,
        "node_type": "array",
        "shape": [3, 120, 128],
        "chunk_grid": grid,
        "codecs": [sharding],
    }
    put(root / "0" / "zarr.json", json.dumps(meta))
    for shard_row, shard_column in itertools.product(range(2), range(2)):
        if (shard_row, shard_column) in without_shards:
            continue
        entries: list[int] = []
        body = b""
        for inner_row, inner_column in itertools.product(range(2), range(2)):
            cell = (0, shard_row * 2 + inner_row, shard_column * 2 + inner_column)
            if cell in missing:
                entries += [EMPTY, EMPTY]
                continue
            entries += [(0 if location == "end" else 68) + len(body), 5]
            body += b"chunk"
        index = struct.pack("<8Q", *entries) + (b"\x00" * 4 if checksum else b"")
        content = body + index if location == "end" else index + body
        put(root / "0" / "c" / "0" / str(shard_row) / str(shard_column), content)
    return root


@pytest.mark.parametrize(("location", "checksum"), [("end", True), ("end", False), ("start", True)])
def test_a_sharded_store_reports_inner_chunks_as_tiles(
    tmp_path: Path, location: str, checksum: bool
) -> None:
    root = write_sharded(
        tmp_path / "sharded.zarr", [(0, 0, 1)], location, checksum, without_shards=[(1, 1)]
    )
    level = zarr_tile_index(root)["levels"][0]
    assert (level["tileWidth"], level["tileHeight"]) == (32, 32)
    assert (level["width"], level["height"]) == (128, 120)
    assert level["absentTiles"] == [[1, 1], [10, 2], [14, 2]]


def test_the_committed_sharded_jpeg_store_has_every_tile() -> None:
    document = zarr_tile_index(SYNTHETIC / "synthetic-jpeg-sharded.ome.zarr")
    assert document["zarrVersion"] == 3
    assert [
        (level["width"], level["height"], level["tileWidth"], level["absentTiles"])
        for level in document["levels"]
    ] == [(1024, 768, 256, []), (512, 384, 256, []), (256, 192, 256, [])]


def test_a_shard_index_this_reader_cannot_parse_is_refused(tmp_path: Path) -> None:
    root = write_sharded(tmp_path / "sharded.zarr", [])
    meta = json.loads((root / "0" / "zarr.json").read_text())
    for configuration in (
        {},
        {"chunk_shape": [3, 48, 48], "index_codecs": [{"name": "bytes"}]},
        {"chunk_shape": [3, 32, 32], "index_codecs": [{"name": "bytes"}, {"name": "zstd"}]},
    ):
        meta["codecs"] = [{"name": "sharding_indexed", "configuration": configuration}]
        (root / "0" / "zarr.json").write_text(json.dumps(meta))
        with pytest.raises(UnsupportedZarrError):
            zarr_tile_index(root)
