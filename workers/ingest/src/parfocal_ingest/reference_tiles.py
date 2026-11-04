import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import openslide
import tifffile
from PIL import Image

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Level, Pyramid, Reader, main_series, read_pyramid
from parfocal_ingest.thumbnail import background_of, flattened

SAMPLED_LEVELS = 2
LONGEST_WINDOW = 256
SHORTEST_WINDOW = 64
CANDIDATE_STEPS = 6


@dataclass(frozen=True)
class Window:
    level: int
    downsample: int
    x: int
    y: int
    width: int
    height: int

    @property
    def file(self) -> str:
        return f"level-{self.level}-{self.x}-{self.y}.png"


def tile_size(level: Level) -> tuple[int, int]:
    width = level.stored.tile_width or LONGEST_WINDOW
    height = level.stored.tile_height or LONGEST_WINDOW
    return width, height


def corner_windows(level: Level) -> list[Window]:
    tile_width, tile_height = tile_size(level)
    columns, rows = -(-level.width // tile_width), -(-level.height // tile_height)
    if columns < 2 or rows < 2:
        return []
    width = min(LONGEST_WINDOW, max(SHORTEST_WINDOW, tile_width))
    height = min(LONGEST_WINDOW, max(SHORTEST_WINDOW, tile_height))
    steps = range(1, CANDIDATE_STEPS)
    corners_x = sorted(
        {max(1, min(columns - 1, round(columns * k / CANDIDATE_STEPS))) for k in steps}
    )
    corners_y = sorted({max(1, min(rows - 1, round(rows * k / CANDIDATE_STEPS))) for k in steps})
    return [
        Window(
            level=level.index,
            downsample=level.downsample,
            x=column * tile_width - width // 2,
            y=row * tile_height - height // 2,
            width=width,
            height=height,
        )
        for column in corners_x
        for row in corners_y
        if column * tile_width + width // 2 <= level.width
        and row * tile_height + height // 2 <= level.height
    ]


def texture(image: Image.Image) -> float:
    return float(np.asarray(image.convert("L"), dtype=np.float64).std())


def sample_windows(path: Path, found: Format, pyramid: Pyramid) -> list[tuple[Window, Image.Image]]:
    chosen: list[tuple[Window, Image.Image]] = []
    for level in pyramid.levels:
        candidates = [
            (window, read_window(path, found, pyramid, window)) for window in corner_windows(level)
        ]
        if candidates:
            chosen.append(max(candidates, key=lambda pair: texture(pair[1])))
        if len(chosen) == SAMPLED_LEVELS:
            break
    return chosen


def openslide_window(path: Path, found: Format, window: Window) -> Image.Image:
    with openslide.OpenSlide(path) as slide:
        origin_x = origin_y = 0
        if found is Format.LEICA_SCN:
            origin_x = int(slide.properties.get("openslide.region[0].x", 0))
            origin_y = int(slide.properties.get("openslide.region[0].y", 0))
        index = min(
            range(slide.level_count),
            key=lambda k: abs(slide.level_downsamples[k] - window.downsample),
        )
        exact = slide.level_downsamples[index]
        location = (origin_x + round(window.x * exact), origin_y + round(window.y * exact))
        region = slide.read_region(location, index, (window.width, window.height))
        return flattened(region, background_of(slide))


def tifffile_window(path: Path, window: Window) -> Image.Image:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            raise ValueError("no slide series")
        pixels = series.levels[window.level].asarray()
    crop = pixels[window.y : window.y + window.height, window.x : window.x + window.width]
    return flattened(Image.fromarray(np.ascontiguousarray(crop)), (255, 255, 255))


def read_window(path: Path, found: Format, pyramid: Pyramid, window: Window) -> Image.Image:
    match pyramid.reader:
        case Reader.OPENSLIDE:
            return openslide_window(path, found, window)
        case Reader.TIFFFILE:
            return tifffile_window(path, window)
        case Reader.WSIDICOM:
            raise ValueError(
                "the browser reader does not open DICOM, so there is nothing to compare"
            )


def write_reference(path: Path, into: Path) -> list[Window]:
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    if found.format is None:
        raise ValueError(f"{path.name} is not a readable slide")
    pyramid = read_pyramid(path, found)
    if not isinstance(pyramid, Pyramid):
        raise ValueError(f"{path.name} has no pyramid: {pyramid}")
    into.mkdir(parents=True, exist_ok=True)
    sampled = sample_windows(path, found.format, pyramid)
    for window, image in sampled:
        image.save(into / window.file, optimize=True)
    windows = [window for window, _ in sampled]
    manifest = {
        "fixture": path.name,
        "reader": pyramid.reader.value,
        "windows": [{**asdict(window), "file": window.file} for window in windows],
    }
    (into / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return windows


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m parfocal_ingest.reference_tiles SLIDE OUTPUT_DIR")
    windows = write_reference(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"wrote {len(windows)} windows to {sys.argv[2]}")


if __name__ == "__main__":
    main()
