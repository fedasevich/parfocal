import argparse
import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import tifffile

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Level, Pyramid, read_pyramid
from parfocal_ingest.thumbnail import level_image

OVERVIEW_LEVELS_NAME = "overview-levels.tiff"
LARGEST_VIEWER_TILE = 1024
FALLBACK_VIEWER_TILE = 512
TIFF_TILE_STEP = 16
MAX_SOURCE_PIXELS = 1 << 25
BRIGHTFIELD = frozenset({"rgb", "ycbcr"})


@dataclass(frozen=True)
class OverviewLevels:
    data: bytes
    downsamples: tuple[int, ...]
    tile: int

    def reference(self) -> dict[str, Any]:
        return {"path": OVERVIEW_LEVELS_NAME, "downsamples": list(self.downsamples)}


def viewer_tile(base: Level) -> int:
    width, height = base.stored.tile_width, base.stored.tile_height
    if width is not None and width == height and 0 < width <= LARGEST_VIEWER_TILE:
        return width
    return FALLBACK_VIEWER_TILE


def missing_downsamples(pyramid: Pyramid, tile: int) -> list[int]:
    base = pyramid.levels[0]
    downsample = pyramid.levels[-1].downsample
    missing: list[int] = []
    while math.ceil(base.width / downsample) > tile or math.ceil(base.height / downsample) > tile:
        downsample *= 2
        missing.append(downsample)
    return missing


def box_average(pixels: npt.NDArray[np.uint8], residual: int) -> npt.NDArray[np.uint8]:
    height, width = pixels.shape[:2]
    rows = np.arange(0, height, residual)
    columns = np.arange(0, width, residual)
    sums = np.add.reduceat(
        np.add.reduceat(pixels, rows, axis=0, dtype=np.uint32), columns, axis=1, dtype=np.uint32
    )
    row_counts = np.minimum(rows + residual, height) - rows
    column_counts = np.minimum(columns + residual, width) - columns
    counts = (row_counts[:, None] * column_counts[None, :])[:, :, None].astype(np.uint32)
    return ((2 * sums + counts) // (2 * counts)).astype(np.uint8)


def write_levels(levels: list[npt.NDArray[np.uint8]], tile: int) -> bytes:
    buffer = io.BytesIO()
    with tifffile.TiffWriter(buffer) as writer:
        for pixels in levels:
            writer.write(
                pixels,
                tile=(tile, tile),
                compression="zlib",
                predictor=True,
                photometric="rgb",
                metadata=None,
            )
    return buffer.getvalue()


def overview_levels(path: Path, found: Format, pyramid: Pyramid) -> OverviewLevels | None:
    base = pyramid.levels[0]
    if base.stored.photometric not in BRIGHTFIELD or pyramid.planes != 1:
        return None
    tile = viewer_tile(base)
    missing = missing_downsamples(pyramid, tile)
    coarsest = pyramid.levels[-1]
    if not missing or coarsest.width * coarsest.height > MAX_SOURCE_PIXELS:
        return None
    if tile % TIFF_TILE_STEP != 0:
        return None
    source = np.asarray(level_image(path, found, pyramid, coarsest).convert("RGB"))
    source = source[: math.ceil(base.height / coarsest.downsample)]
    source = source[:, : math.ceil(base.width / coarsest.downsample)]
    derived = [box_average(source, downsample // coarsest.downsample) for downsample in missing]
    return OverviewLevels(write_levels(derived, tile), tuple(missing), tile)


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the derived overview levels of a slide")
    parser.add_argument("slide", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    with arguments.slide.open("rb") as handle:
        identified = identify(handle, arguments.slide.name)
    found = read_pyramid(arguments.slide, identified)
    if not isinstance(found, Pyramid) or identified.format is None:
        raise SystemExit(f"{arguments.slide.name} has no readable pyramid")
    built = overview_levels(arguments.slide, identified.format, found)
    if built is None:
        print("none")
        return
    arguments.output.write_bytes(built.data)
    print(",".join(str(downsample) for downsample in built.downsamples))


if __name__ == "__main__":
    main()
