import shutil
import sys
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import openslide
import tifffile
from PIL import Image
from wsidicom import WsiDicom

from parfocal_common.jobs import StepFailedError
from parfocal_ingest.conversion import Trigger, format_trigger
from parfocal_ingest.identify import Format, Identified, Refusal
from parfocal_ingest.isolated_child import ScopedStorage
from parfocal_ingest.parse_jobs import identified_in, identify_file, unpacked_in
from parfocal_ingest.pyramid import Pyramid, Reader, read_pyramid
from parfocal_ingest.source_levels import READ_BLOCK, UnconvertibleError
from parfocal_ingest.thumbnail import WHITE, background_of, flattened

TILE = 256
COMPRESSION = "zlib"
COMPRESSION_LEVEL = 6
WRITE_WORKERS = 4
MICRONS_PER_CENTIMETRE = 10_000
CONVERTED_VARIANT = "pyramid-tiff"
CONVERTED_OUTPUT = "original.tiff"
BAND_ROWS = 4 * TILE


type BandReader = Callable[[int, int, int, int], Image.Image]


@dataclass(frozen=True)
class PyramidTiff:
    path: Path
    trigger: Trigger
    levels: tuple[tuple[int, int], ...]


@contextmanager
def band_reader(readable: Path, pyramid: Pyramid, index: int) -> Iterator[BandReader]:
    level = pyramid.levels[index]
    if pyramid.reader is Reader.WSIDICOM:
        exponent = level.downsample.bit_length() - 1
        with WsiDicom.open(readable) as dicom:

            def dicom_region(left: int, top: int, width: int, height: int) -> Image.Image:
                return flattened(dicom.read_region((left, top), exponent, (width, height)), WHITE)

            yield dicom_region
        return
    if pyramid.reader is Reader.OPENSLIDE:
        with openslide.OpenSlide(readable) as slide:
            step = round(slide.level_downsamples[level.index])
            background = background_of(slide)

            def openslide_region(left: int, top: int, width: int, height: int) -> Image.Image:
                region = slide.read_region((left * step, top * step), level.index, (width, height))
                return flattened(region, background)

            yield openslide_region
        return
    raise UnconvertibleError(f"{pyramid.reader} levels are not converted to a pyramid TIFF")


def band_of(read: BandReader, top: int, width: int, height: int) -> np.ndarray:
    band = np.empty((height, width, 3), dtype=np.uint8)
    for left in range(0, width, READ_BLOCK):
        size = min(READ_BLOCK, width - left)
        band[:, left : left + size] = np.asarray(read(left, top, size, height))
    return band


def level_tiles(read: BandReader, width: int, height: int) -> Iterator[np.ndarray]:
    for top in range(0, height, BAND_ROWS):
        band = band_of(read, top, width, min(BAND_ROWS, height - top))
        for row in range(0, band.shape[0], TILE):
            for left in range(0, width, TILE):
                tile = band[row : row + TILE, left : left + TILE]
                if tile.shape[:2] == (TILE, TILE):
                    yield tile
                    continue
                padded = np.zeros((TILE, TILE, 3), dtype=np.uint8)
                padded[: tile.shape[0], : tile.shape[1]] = tile
                yield padded
        del band


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
                resolution = resolution_of(pyramid, level.downsample)
                with band_reader(readable, pyramid, index) as read:
                    tiff.write(
                        level_tiles(read, level.width, level.height),
                        shape=(level.height, level.width, 3),
                        dtype=np.uint8,
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
                extents.append((level.width, level.height))
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


def converted_at_ingest(identified: Mapping[str, Any]) -> bool:
    return format_trigger(Format(identified["format"])) is not None


def convert_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    local = storage.fetch(arguments["key"])
    identified = identified_in(arguments)
    target = Path(arguments["out"]) / CONVERTED_OUTPUT
    try:
        if identified.format is None or format_trigger(identified.format) is None:
            raise UnconvertibleError(f"{identified.format} is not converted at ingest")
        readable = unpacked_in(local.parent, local, identified)
        source = read_pyramid(readable, identified)
        if not isinstance(source, Pyramid):
            raise StepFailedError(source)
        write_pyramid_tiff(readable, identified.format, source, target, local.parent / "conversion")
        served = read_pyramid(target, identify_file(target, target.name))
        if not isinstance(served, Pyramid):
            raise UnconvertibleError("the pyramid TIFF does not read back")
    except StepFailedError:
        target.unlink(missing_ok=True)
        raise
    except Exception as error:
        target.unlink(missing_ok=True)
        raise StepFailedError(Refusal.UNCONVERTIBLE) from error
    base = served.levels[0]
    return {
        "reader": served.reader.value,
        "width": base.width,
        "height": base.height,
        "levels": len(served.levels),
        "mpp_x": source.scale.mpp_x,
        "mpp_y": source.scale.mpp_y,
        "objective_power": source.scale.objective_power,
        "notices": [notice.value for notice in source.notices],
    }


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
