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

import numpy as np
from numpy.lib.format import open_memmap
from PIL import Image

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, Reader, read_pyramid
from parfocal_ingest.source_levels import UnconvertibleError, source_level, tifffile_names

CHUNK = 512
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
    MIRAX_OR_DICOM = "mirax-or-dicom"


FIRED: frozenset[Trigger] = frozenset({Trigger.MIRAX_OR_DICOM})
WITHOUT_BROWSER_READER = frozenset({Format.MIRAX, Format.DICOM})


class Chunks(StrEnum):
    JPEG = "jpeg"
    ZSTD = "zstd"


TRIGGER_CHUNKS = {Trigger.JPEG2000_DECODE_BUDGET: Chunks.ZSTD}


class NotTriggeredError(ValueError):
    pass


@dataclass(frozen=True)
class Planned:
    downsample: int
    from_source: bool


@dataclass(frozen=True)
class Converted:
    store: Path
    chunks: Chunks
    levels: tuple[tuple[int, int], ...]
    trigger: Trigger | None
    from_source: tuple[bool, ...]


def trigger_for(pyramid: Pyramid, fired: Collection[Trigger] = FIRED) -> Trigger | None:
    if (
        Trigger.JPEG2000_DECODE_BUDGET in fired
        and pyramid.levels[0].stored.compression == "jpeg2000"
    ):
        return Trigger.JPEG2000_DECODE_BUDGET
    return None


def format_trigger(found: Format, fired: Collection[Trigger] = FIRED) -> Trigger | None:
    if Trigger.MIRAX_OR_DICOM in fired and found in WITHOUT_BROWSER_READER:
        return Trigger.MIRAX_OR_DICOM
    return None


def is_brightfield(dtype: np.dtype, channels: int) -> bool:
    return dtype == np.uint8 and channels == 3


def chunks_for(dtype: np.dtype, channels: int) -> Chunks:
    return Chunks.JPEG if is_brightfield(dtype, channels) else Chunks.ZSTD


def level_plan(source: Collection[int], width: int, height: int, chunk: int) -> tuple[Planned, ...]:
    plan = [Planned(1, True)]
    while max(width, height) > chunk and min(width, height) >= 2:
        width, height = width // 2, height // 2
        downsample = plan[-1].downsample * 2
        plan.append(Planned(downsample, downsample in source))
    return tuple(plan)


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


def omero_channels(coarsest: np.ndarray, names: Sequence[str]) -> list[dict[str, Any]]:
    if is_brightfield(coarsest.dtype, coarsest.shape[0]):
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


def slide_of(source: Path) -> tuple[Format, Pyramid]:
    with source.open("rb") as handle:
        found = identify(handle, source.name)
    if found.format is None:
        raise UnconvertibleError(f"{source.name} is not a readable slide")
    pyramid = read_pyramid(source, found)
    if not isinstance(pyramid, Pyramid):
        raise UnconvertibleError(f"{source.name} has no pyramid: {pyramid}")
    return found.format, pyramid


def write_store(
    source: Path,
    store: Path,
    work: Path,
    *,
    trigger: Trigger | None = None,
    chunk: int = CHUNK,
    chunks: Chunks | None = None,
) -> Converted:
    found, pyramid = slide_of(source)
    if pyramid.reader is Reader.WSIDICOM:
        raise UnconvertibleError("DICOM slides are not converted")
    work.mkdir(parents=True, exist_ok=True)
    names = tifffile_names(source) if pyramid.reader is Reader.TIFFFILE else []
    by_downsample = {level.downsample: level for level in pyramid.levels}
    base = pyramid.levels[0]
    plan = level_plan(by_downsample, base.width, base.height, chunk)
    partial = store.with_name(store.name + ".partial")
    shutil.rmtree(partial, ignore_errors=True)
    extents: list[tuple[int, int]] = []
    from_source: list[bool] = []
    first = source_level(source, found, pyramid, base, work / "level-0.npy")
    if first is None:
        raise UnconvertibleError("the finest level could not be read")
    level = first
    kind = chunks or chunks_for(level.dtype, level.shape[0])
    fill = BRIGHTFIELD_BACKGROUND if is_brightfield(level.dtype, level.shape[0]) else 0
    for index, planned in enumerate(plan):
        into = work / f"level-{index}.npy"
        read = (
            source_level(source, found, pyramid, by_downsample[planned.downsample], into)
            if planned.from_source and index > 0
            else None
        )
        if index > 0:
            level = read if read is not None else halved(level, into, chunk)
        write_level(partial / str(index), level, kind, chunk, fill)
        extents.append((level.shape[2], level.shape[1]))
        from_source.append(index == 0 or read is not None)
    write_json(
        partial / "zarr.json",
        group_metadata(store.name, len(extents), pyramid.scale.mpp_x, omero_channels(level, names)),
    )
    shutil.rmtree(store, ignore_errors=True)
    partial.rename(store)
    shutil.rmtree(work, ignore_errors=True)
    return Converted(store, kind, tuple(extents), trigger, tuple(from_source))


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
    if trigger_for(slide_of(source)[1], fired) is not trigger:
        raise NotTriggeredError(f"the {trigger} conversion trigger does not apply to this slide")
    return write_store(
        source, store, work, trigger=trigger, chunk=chunk, chunks=TRIGGER_CHUNKS[trigger]
    )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m parfocal_ingest.conversion SLIDE STORE")
    store = Path(sys.argv[2])
    done = write_store(Path(sys.argv[1]), store, store.with_name(store.name + ".work"))
    print(f"wrote {len(done.levels)} levels of {done.chunks} chunks to {done.store}")


if __name__ == "__main__":
    main()
