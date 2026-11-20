import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import tifffile
from numpy.lib.format import open_memmap
from wsidicom import WsiDicom

from parfocal_ingest.conversion import Trigger, format_trigger
from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.parse_jobs import identify_file, unpacked_in
from parfocal_ingest.pyramid import Pyramid, Reader, read_pyramid
from parfocal_ingest.source_levels import READ_BLOCK, UnconvertibleError, openslide_level
from parfocal_ingest.thumbnail import WHITE, flattened

TILE = 256
COMPRESSION = "zlib"
COMPRESSION_LEVEL = 6
WRITE_WORKERS = 4
MICRONS_PER_CENTIMETRE = 10_000
CONVERTED_VARIANT = "pyramid-tiff"


@dataclass(frozen=True)
class PyramidTiff:
    path: Path
    trigger: Trigger
    levels: tuple[tuple[int, int], ...]


def dicom_level(folder: Path, downsample: int, width: int, height: int, into: Path) -> np.ndarray:
    exponent = downsample.bit_length() - 1
    pixels = open_memmap(into, mode="w+", dtype=np.uint8, shape=(height, width, 3))
    with WsiDicom.open(folder) as slide:
        for top in range(0, height, READ_BLOCK):
            for left in range(0, width, READ_BLOCK):
                size = (min(READ_BLOCK, width - left), min(READ_BLOCK, height - top))
                region = slide.read_region((left, top), exponent, size)
                pixels[top : top + size[1], left : left + size[0]] = np.asarray(
                    flattened(region, WHITE)
                )
    pixels.flush()
    return pixels


def source_pixels(
    readable: Path, found: Format, pyramid: Pyramid, index: int, into: Path
) -> np.ndarray:
    level = pyramid.levels[index]
    if pyramid.reader is Reader.WSIDICOM:
        return dicom_level(readable, level.downsample, level.width, level.height, into)
    if pyramid.reader is Reader.OPENSLIDE:
        return openslide_level(readable, found, level.index, into).transpose(1, 2, 0)
    raise UnconvertibleError(f"{pyramid.reader} levels are not converted to a pyramid TIFF")


def resolution_of(pyramid: Pyramid, downsample: int) -> tuple[float, float] | None:
    scale = pyramid.scale
    if scale.mpp_x is None or scale.mpp_y is None:
        return None
    return (
        MICRONS_PER_CENTIMETRE / (scale.mpp_x * downsample),
        MICRONS_PER_CENTIMETRE / (scale.mpp_y * downsample),
    )


def write_pyramid_tiff(
    readable: Path, found: Format, pyramid: Pyramid, target: Path, work: Path
) -> PyramidTiff:
    trigger = format_trigger(found)
    if trigger is None:
        raise UnconvertibleError(f"no fired conversion trigger applies to {found}")
    work.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".partial")
    extents: list[tuple[int, int]] = []
    try:
        with tifffile.TiffWriter(partial, bigtiff=True) as tiff:
            for index, level in enumerate(pyramid.levels):
                into = work / f"level-{index}.npy"
                pixels = source_pixels(readable, found, pyramid, index, into)
                resolution = resolution_of(pyramid, level.downsample)
                tiff.write(
                    pixels,
                    photometric="rgb",
                    tile=(TILE, TILE),
                    compression=COMPRESSION,
                    compressionargs={"level": COMPRESSION_LEVEL},
                    predictor=True,
                    subfiletype=0 if index == 0 else 1,
                    maxworkers=WRITE_WORKERS,
                    metadata=None,
                    **(
                        {}
                        if resolution is None
                        else {"resolution": resolution, "resolutionunit": "CENTIMETER"}
                    ),
                )
                extents.append((pixels.shape[1], pixels.shape[0]))
                del pixels
                into.unlink()
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)
    return PyramidTiff(target, trigger, tuple(extents))


def convert_original(
    original: Path, target: Path, work: Path
) -> tuple[Identified, Pyramid, PyramidTiff]:
    identified = identify_file(original, original.name)
    if identified.format is None:
        raise UnconvertibleError(f"{original.name} is not a slide this app reads")
    source_folder = work / "source"
    source_folder.mkdir(parents=True, exist_ok=True)
    readable = unpacked_in(source_folder, original, identified)
    source = read_pyramid(readable, identified)
    if not isinstance(source, Pyramid):
        raise UnconvertibleError(f"{original.name} has no readable pyramid")
    done = write_pyramid_tiff(readable, identified.format, source, target, work / "levels")
    return identified, source, done


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m parfocal_ingest.pyramid_tiff ORIGINAL TARGET_TIFF")
    original, target = Path(sys.argv[1]), Path(sys.argv[2])
    work = target.with_name(target.name + ".work")
    try:
        _, _, done = convert_original(original, target, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"wrote {len(done.levels)} levels to {done.path}")


if __name__ == "__main__":
    main()
