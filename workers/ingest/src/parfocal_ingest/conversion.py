import io
import json
import shutil
import sys
from collections.abc import Collection, Sequence
from compression import zstd
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import numpy as np
import openslide
import tifffile
from numpy.lib.format import open_memmap
from PIL import Image

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, Reader, children, main_series, read_pyramid
from parfocal_ingest.thumbnail import background_of, flattened

CHUNK = 512
READ_BLOCK = 2048
JPEG_QUALITY = 90
ZSTD_LEVEL = 3
NGFF_VERSION = "0.5"
JPEG_CODEC = "imagecodecs_jpeg"
BRIGHTFIELD_BACKGROUND = 255
RGB_CHANNELS = (("Red", "FF0000"), ("Green", "00FF00"), ("Blue", "0000FF"))
PALETTE = ("0000FF", "00FF00", "FF0000", "FF00FF", "00FFFF", "FFFF00")
WINDOW_PERCENTILES = (0.5, 99.8)
LITTLE_ENDIAN = {"name": "bytes", "configuration": {"endian": "little"}}


class Trigger(StrEnum):
    JPEG2000_DECODE_BUDGET = "jpeg2000-decode-budget"


FIRED: frozenset[Trigger] = frozenset()


class Chunks(StrEnum):
    JPEG = "jpeg"
    ZSTD = "zstd"


class NotTriggeredError(ValueError):
    pass


class UnconvertibleError(ValueError):
    pass


@dataclass(frozen=True)
class Converted:
    store: Path
    chunks: Chunks
    levels: tuple[tuple[int, int], ...]
    trigger: Trigger | None


def trigger_for(pyramid: Pyramid, fired: Collection[Trigger] = FIRED) -> Trigger | None:
    if (
        Trigger.JPEG2000_DECODE_BUDGET in fired
        and pyramid.levels[0].stored.compression == "jpeg2000"
    ):
        return Trigger.JPEG2000_DECODE_BUDGET
    return None


def chunks_for(dtype: np.dtype, channels: int) -> Chunks:
    return Chunks.JPEG if dtype == np.uint8 and channels == 3 else Chunks.ZSTD


def openslide_level_zero(path: Path, found: Format, into: Path) -> np.ndarray:
    with openslide.OpenSlide(path) as slide:
        origin_x = origin_y = 0
        if found is Format.LEICA_SCN:
            origin_x = int(slide.properties.get("openslide.region[0].x", 0))
            origin_y = int(slide.properties.get("openslide.region[0].y", 0))
        width, height = slide.dimensions
        background = background_of(slide)
        pixels = open_memmap(into, mode="w+", dtype=np.uint8, shape=(height, width, 3))
        for top in range(0, height, READ_BLOCK):
            for left in range(0, width, READ_BLOCK):
                size = (min(READ_BLOCK, width - left), min(READ_BLOCK, height - top))
                region = slide.read_region((origin_x + left, origin_y + top), 0, size)
                rgb = np.asarray(flattened(region, background))
                pixels[top : top + size[1], left : left + size[0]] = rgb
        pixels.flush()
    return pixels.transpose(2, 0, 1)


def planar(pixels: np.ndarray, axes: str) -> np.ndarray:
    match axes:
        case "YXS":
            return pixels.transpose(2, 0, 1)
        case "CYX" | "SYX":
            return pixels
        case "YX":
            return pixels[np.newaxis]
        case _:
            raise UnconvertibleError(f"axes {axes} are not converted")


def tifffile_level_zero(path: Path, into: Path) -> tuple[np.ndarray, list[str]]:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            raise UnconvertibleError("no slide series")
        level = series.levels[0]
        pixels = open_memmap(
            into, mode="w+", dtype=level.dtype.newbyteorder("="), shape=level.shape
        )
        level.asarray(out=pixels)
        pixels.flush()
        names = channel_names(tiff.ome_metadata or "", tiff.series.index(series))
        return planar(pixels, level.axes), names


def channel_names(ome: str, image: int) -> list[str]:
    try:
        root = ElementTree.fromstring(ome)
    except ElementTree.ParseError:
        return []
    images = list(children(root, "Image"))
    if image >= len(images):
        return []
    return [channel.get("Name", "") for channel in children(images[image], "Channel")]


def halved(level: np.ndarray, into: Path, chunk: int) -> np.ndarray:
    channels, height, width = level.shape
    smaller = open_memmap(
        into, mode="w+", dtype=level.dtype, shape=(channels, height // 2, width // 2)
    )
    for top in range(0, height // 2, chunk):
        bottom = min(height // 2, top + chunk)
        strip = level[:, top * 2 : bottom * 2, : width // 2 * 2].astype(np.float32)
        blocks = strip.reshape(channels, bottom - top, 2, width // 2, 2)
        smaller[:, top:bottom] = np.rint(blocks.mean(axis=(2, 4))).astype(level.dtype)
    smaller.flush()
    return smaller


def padded(level: np.ndarray, row: int, column: int, chunk: int, fill: int) -> np.ndarray:
    channels = level.shape[0]
    block = np.full((channels, chunk, chunk), fill, dtype=level.dtype)
    part = level[:, row * chunk : (row + 1) * chunk, column * chunk : (column + 1) * chunk]
    block[:, : part.shape[1], : part.shape[2]] = part
    return block


def encoded(block: np.ndarray, chunks: Chunks) -> bytes:
    if chunks is Chunks.JPEG:
        output = io.BytesIO()
        image = Image.fromarray(np.ascontiguousarray(block.transpose(1, 2, 0)), "RGB")
        image.save(output, "JPEG", quality=JPEG_QUALITY, subsampling=0)
        return output.getvalue()
    return zstd.compress(block.astype(block.dtype.newbyteorder("<")).tobytes(), ZSTD_LEVEL)


def codecs_for(chunks: Chunks) -> list[dict[str, Any]]:
    if chunks is Chunks.JPEG:
        return [LITTLE_ENDIAN, {"name": JPEG_CODEC, "configuration": {"level": JPEG_QUALITY}}]
    return [
        LITTLE_ENDIAN,
        {"name": "zstd", "configuration": {"level": ZSTD_LEVEL, "checksum": False}},
    ]


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def write_level(folder: Path, level: np.ndarray, chunks: Chunks, chunk: int, fill: int) -> None:
    channels, height, width = level.shape
    write_json(
        folder / "zarr.json",
        {
            "zarr_format": 3,
            "node_type": "array",
            "shape": [channels, height, width],
            "data_type": str(level.dtype.newbyteorder("=").name),
            "chunk_grid": {
                "name": "regular",
                "configuration": {"chunk_shape": [channels, chunk, chunk]},
            },
            "chunk_key_encoding": {"name": "default", "configuration": {"separator": "/"}},
            "fill_value": fill,
            "codecs": codecs_for(chunks),
            "attributes": {},
            "dimension_names": ["c", "y", "x"],
        },
    )
    for row in range(-(-height // chunk)):
        for column in range(-(-width // chunk)):
            path = folder / "c" / "0" / str(row) / str(column)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(encoded(padded(level, row, column, chunk, fill), chunks))


def window_of(level: np.ndarray, channel: int) -> dict[str, int]:
    sample = level[channel, :: max(1, level.shape[1] // 512), :: max(1, level.shape[2] // 512)]
    low, high = (int(np.percentile(sample, p)) for p in WINDOW_PERCENTILES)
    top = int(np.iinfo(level.dtype).max) if level.dtype.kind in "ui" else int(sample.max())
    return {"start": low, "end": max(high, low + 1), "min": 0, "max": top}


def omero_channels(
    chunks: Chunks, coarsest: np.ndarray, names: Sequence[str]
) -> list[dict[str, Any]]:
    if chunks is Chunks.JPEG:
        return [
            {
                "label": label,
                "color": color,
                "active": True,
                "window": {"start": 0, "end": 255, "min": 0, "max": 255},
            }
            for label, color in RGB_CHANNELS
        ]
    return [
        {
            "label": (names[index] if index < len(names) and names[index] else f"Channel {index}"),
            "color": PALETTE[index % len(PALETTE)],
            "active": True,
            "window": window_of(coarsest, index),
        }
        for index in range(coarsest.shape[0])
    ]


def group_metadata(
    name: str, levels: int, mpp: float | None, channels: list[dict[str, Any]]
) -> dict[str, Any]:
    unit = {"unit": "micrometer"} if mpp is not None else {}
    step = mpp if mpp is not None else 1.0
    multiscale = {
        "name": name,
        "axes": [
            {"name": "c", "type": "channel"},
            {"name": "y", "type": "space", **unit},
            {"name": "x", "type": "space", **unit},
        ],
        "datasets": [
            {
                "path": str(index),
                "coordinateTransformations": [
                    {"type": "scale", "scale": [1, step * 2**index, step * 2**index]}
                ],
            }
            for index in range(levels)
        ],
    }
    return {
        "zarr_format": 3,
        "node_type": "group",
        "attributes": {
            "ome": {
                "version": NGFF_VERSION,
                "multiscales": [multiscale],
                "omero": {"channels": channels},
            }
        },
    }


def write_store(
    source: Path,
    store: Path,
    work: Path,
    *,
    trigger: Trigger | None = None,
    chunk: int = CHUNK,
) -> Converted:
    with source.open("rb") as handle:
        found = identify(handle, source.name)
    if found.format is None:
        raise UnconvertibleError(f"{source.name} is not a readable slide")
    pyramid = read_pyramid(source, found)
    if not isinstance(pyramid, Pyramid):
        raise UnconvertibleError(f"{source.name} has no pyramid: {pyramid}")
    work.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    match pyramid.reader:
        case Reader.OPENSLIDE:
            level = openslide_level_zero(source, found.format, work / "level-0.npy")
        case Reader.TIFFFILE:
            level, names = tifffile_level_zero(source, work / "level-0.npy")
        case Reader.WSIDICOM:
            raise UnconvertibleError("DICOM slides are not converted")
    chunks = chunks_for(level.dtype, level.shape[0])
    fill = BRIGHTFIELD_BACKGROUND if chunks is Chunks.JPEG else 0
    partial = store.with_name(store.name + ".partial")
    shutil.rmtree(partial, ignore_errors=True)
    extents: list[tuple[int, int]] = []
    index = 0
    while True:
        write_level(partial / str(index), level, chunks, chunk, fill)
        extents.append((level.shape[2], level.shape[1]))
        if max(level.shape[1:]) <= chunk or min(level.shape[1:]) < 2:
            break
        index += 1
        level = halved(level, work / f"level-{index}.npy", chunk)
    channels = omero_channels(chunks, level, names)
    write_json(
        partial / "zarr.json",
        group_metadata(store.name, len(extents), pyramid.scale.mpp_x, channels),
    )
    shutil.rmtree(store, ignore_errors=True)
    partial.rename(store)
    shutil.rmtree(work, ignore_errors=True)
    return Converted(store, chunks, tuple(extents), trigger)


def convert(
    source: Path,
    store: Path,
    work: Path,
    trigger: Trigger,
    fired: Collection[Trigger] = FIRED,
    *,
    chunk: int = CHUNK,
) -> Converted:
    if trigger not in fired:
        raise NotTriggeredError(f"the {trigger} conversion trigger has not fired")
    return write_store(source, store, work, trigger=trigger, chunk=chunk)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m parfocal_ingest.conversion SLIDE STORE")
    store = Path(sys.argv[2])
    done = write_store(Path(sys.argv[1]), store, store.with_name(store.name + ".work"))
    print(f"wrote {len(done.levels)} levels of {done.chunks} chunks to {done.store}")


if __name__ == "__main__":
    main()
