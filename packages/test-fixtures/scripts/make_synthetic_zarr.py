import json
import shutil
import struct
from pathlib import Path

import imagecodecs
import numpy as np
from make_synthetic import MICRONS_PER_PIXEL, SYNTHETIC, TILE, base_image, pyramid

QUALITY = 90
SHARD = 2
BACKGROUND = 255
EMPTY = 2**64 - 1
CODEC = "imagecodecs_jpeg"
CHANNELS = (("Red", "FF0000"), ("Green", "00FF00"), ("Blue", "0000FF"))
CRC32C_POLYNOMIAL = 0x82F63B78


def crc32c(data: bytes) -> int:
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (CRC32C_POLYNOMIAL if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


def jpeg_chunk(level: np.ndarray, row: int, column: int) -> bytes:
    chunk = np.full((TILE, TILE, 3), BACKGROUND, dtype=np.uint8)
    part = level[row * TILE : (row + 1) * TILE, column * TILE : (column + 1) * TILE]
    chunk[: part.shape[0], : part.shape[1]] = part
    return imagecodecs.jpeg_encode(chunk, level=QUALITY, subsampling="444")


def attributes(levels: list[np.ndarray], version: str | None) -> dict:
    datasets = [
        {
            "path": str(index),
            "coordinateTransformations": [
                {
                    "type": "scale",
                    "scale": [1, MICRONS_PER_PIXEL * 2**index, MICRONS_PER_PIXEL * 2**index],
                }
            ],
        }
        for index in range(len(levels))
    ]
    axes = [
        {"name": "c", "type": "channel"},
        {"name": "y", "type": "space", "unit": "micrometer"},
        {"name": "x", "type": "space", "unit": "micrometer"},
    ]
    multiscale = {"axes": axes, "datasets": datasets}
    if version is not None:
        multiscale["version"] = version
    channels = [
        {"label": label, "color": color, "window": {"start": 0, "end": 255}}
        for label, color in CHANNELS
    ]
    return {"multiscales": [multiscale], "omero": {"channels": channels}}


def put(path: Path, content: bytes | dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else json.dumps(content).encode())


def grid(level: np.ndarray) -> tuple[int, int]:
    return -(-level.shape[0] // TILE), -(-level.shape[1] // TILE)


def write_v2(root: Path, levels: list[np.ndarray]) -> None:
    put(root / ".zgroup", {"zarr_format": 2})
    put(root / ".zattrs", attributes(levels, "0.4"))
    for index, level in enumerate(levels):
        folder = root / str(index)
        put(
            folder / ".zarray",
            {
                "zarr_format": 2,
                "shape": [3, level.shape[0], level.shape[1]],
                "chunks": [3, TILE, TILE],
                "dtype": "|u1",
                "compressor": {"id": CODEC, "level": QUALITY},
                "fill_value": BACKGROUND,
                "order": "C",
                "filters": None,
                "dimension_separator": "/",
            },
        )
        rows, columns = grid(level)
        for row in range(rows):
            for column in range(columns):
                put(folder / "0" / str(row) / str(column), jpeg_chunk(level, row, column))


def write_v3_sharded(root: Path, levels: list[np.ndarray]) -> None:
    group = {"ome": {"version": "0.5", **attributes(levels, None)}}
    put(root / "zarr.json", {"zarr_format": 3, "node_type": "group", "attributes": group})
    little = {"name": "bytes", "configuration": {"endian": "little"}}
    for index, level in enumerate(levels):
        folder = root / str(index)
        sharding = {
            "name": "sharding_indexed",
            "configuration": {
                "chunk_shape": [3, TILE, TILE],
                "codecs": [little, {"name": CODEC, "configuration": {"level": QUALITY}}],
                "index_codecs": [little, {"name": "crc32c"}],
                "index_location": "end",
            },
        }
        put(
            folder / "zarr.json",
            {
                "zarr_format": 3,
                "node_type": "array",
                "shape": [3, level.shape[0], level.shape[1]],
                "data_type": "uint8",
                "chunk_grid": {
                    "name": "regular",
                    "configuration": {"chunk_shape": [3, TILE * SHARD, TILE * SHARD]},
                },
                "chunk_key_encoding": {"name": "default", "configuration": {"separator": "/"}},
                "fill_value": BACKGROUND,
                "codecs": [sharding],
                "attributes": {},
                "dimension_names": ["c", "y", "x"],
            },
        )
        rows, columns = grid(level)
        for shard_row in range(-(-rows // SHARD)):
            for shard_column in range(-(-columns // SHARD)):
                parts: list[bytes] = []
                entries: list[int] = []
                offset = 0
                for inner in range(SHARD * SHARD):
                    row = shard_row * SHARD + inner // SHARD
                    column = shard_column * SHARD + inner % SHARD
                    if row >= rows or column >= columns:
                        entries += [EMPTY, EMPTY]
                        continue
                    chunk = jpeg_chunk(level, row, column)
                    parts.append(chunk)
                    entries += [offset, len(chunk)]
                    offset += len(chunk)
                table = struct.pack(f"<{len(entries)}Q", *entries)
                parts.append(table + struct.pack("<I", crc32c(table)))
                put(folder / "c" / "0" / str(shard_row) / str(shard_column), b"".join(parts))


def main() -> None:
    levels = pyramid(base_image())
    stores = {
        "synthetic-jpeg.ome.zarr": write_v2,
        "synthetic-jpeg-sharded.ome.zarr": write_v3_sharded,
    }
    for name, write in stores.items():
        root = SYNTHETIC / name
        shutil.rmtree(root, ignore_errors=True)
        write(root, levels)
        files = [path for path in root.rglob("*") if path.is_file()]
        print(f"{name}: {len(files)} files, {sum(path.stat().st_size for path in files)} bytes")


if __name__ == "__main__":
    main()
