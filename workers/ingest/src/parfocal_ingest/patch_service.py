import io
import math
from collections import OrderedDict
from collections.abc import Callable
from compression import zstd
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import openslide
import tifffile
from numpy.typing import NDArray
from PIL import Image

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, Reader, main_series, read_pyramid
from parfocal_ingest.source_levels import STORED_TILE_COMPRESSIONS, stored_tile
from parfocal_ingest.thumbnail import WHITE, background_of, flattened
from parfocal_ingest.zarr_index import (
    ArrayLayout,
    UnsupportedZarrError,
    array_layout,
    chunk_path,
    group_attributes,
    read_json,
)

PATCH_MICRONS = 128.0
PATCH_SIZE = 256
TILE_CACHE = 512
OPEN_SLIDES = 8
LEVEL_TOLERANCE = 1.001
ZARR_JPEG = "imagecodecs_jpeg"

type Rgb = NDArray[np.uint8]


@dataclass(frozen=True)
class SourceLevel:
    width: int
    height: int
    downsample: float


@dataclass(frozen=True)
class Region:
    level: int
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class Plan:
    region: Region
    size: int
    crop: tuple[float, float, float, float]


class UncalibratedError(ValueError):
    pass


class LruCache[K, V]:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.entries: OrderedDict[K, V] = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key: K, load: Callable[[K], V]) -> V:
        if key in self.entries:
            self.hits += 1
            self.entries.move_to_end(key)
            return self.entries[key]
        self.misses += 1
        value = load(key)
        self.entries[key] = value
        if len(self.entries) > self.capacity:
            _, evicted = self.entries.popitem(last=False)
            close = getattr(evicted, "close", None)
            if callable(close):
                close()
        return value

    def clear(self) -> None:
        for value in self.entries.values():
            close = getattr(value, "close", None)
            if callable(close):
                close()
        self.entries.clear()


class PatchSource(Protocol):
    mpp: float
    levels: tuple[SourceLevel, ...]

    def region(self, region: Region) -> Rgb | None: ...

    def close(self) -> None: ...


def paste(out: Rgb, tile: NDArray[Any], x0: int, y0: int, region: Region) -> None:
    x1, y1 = max(x0, region.left), max(y0, region.top)
    x2 = min(x0 + tile.shape[1], region.left + region.width)
    y2 = min(y0 + tile.shape[0], region.top + region.height)
    if x2 <= x1 or y2 <= y1:
        return
    out[y1 - region.top : y2 - region.top, x1 - region.left : x2 - region.left] = tile[
        y1 - y0 : y2 - y0, x1 - x0 : x2 - x0
    ]


def grid(region: Region, tile_width: int, tile_height: int, width: int, height: int):
    first_row = max(0, region.top // tile_height)
    last_row = min(-(-height // tile_height), -(-(region.top + region.height) // tile_height))
    first_column = max(0, region.left // tile_width)
    last_column = min(-(-width // tile_width), -(-(region.left + region.width) // tile_width))
    for row in range(first_row, last_row):
        for column in range(first_column, last_column):
            yield row, column


def as_rgb(pixels: NDArray[Any]) -> Rgb:
    if pixels.ndim == 2:
        pixels = pixels[:, :, None]
    if pixels.shape[2] == 1:
        pixels = np.repeat(pixels, 3, axis=2)
    if pixels.dtype != np.uint8:
        raise ValueError("the patch service reads 8-bit brightfield slides")
    return np.ascontiguousarray(pixels[:, :, :3])


class OpenSlideSource:
    def __init__(self, path: Path, mpp: float) -> None:
        self.slide = openslide.OpenSlide(path)
        self.mpp = mpp
        self.background = background_of(self.slide)
        self.levels = tuple(
            SourceLevel(width, height, float(downsample))
            for (width, height), downsample in zip(
                self.slide.level_dimensions, self.slide.level_downsamples, strict=True
            )
        )

    def region(self, region: Region) -> Rgb | None:
        downsample = self.levels[region.level].downsample
        location = (round(region.left * downsample), round(region.top * downsample))
        image = self.slide.read_region(location, region.level, (region.width, region.height))
        if not image.getchannel("A").getbbox():
            return None
        return np.asarray(flattened(image, self.background))

    def close(self) -> None:
        self.slide.close()


class TiledTiffSource:
    def __init__(self, path: Path, mpp: float, cache: int) -> None:
        self.tiff = tifffile.TiffFile(path)
        series = main_series(self.tiff)
        if series is None:
            self.tiff.close()
            raise ValueError("no slide series")
        self.pages: list[tifffile.TiffPage] = []
        for level in series.levels:
            page = level.keyframe
            if not isinstance(page, tifffile.TiffPage) or not page.is_tiled:
                self.tiff.close()
                raise ValueError("the slide is not tiled")
            self.pages.append(page)
        base = self.pages[0].imagewidth
        self.levels = tuple(
            SourceLevel(page.imagewidth, page.imagelength, base / page.imagewidth)
            for page in self.pages
        )
        self.mpp = mpp
        self.tiles: LruCache[tuple[int, int], Rgb | None] = LruCache(cache)

    def decoded(self, key: tuple[int, int]) -> Rgb | None:
        level, tile = key
        page = self.pages[level]
        count = page.databytecounts[tile]
        if count == 0:
            return None
        self.tiff.filehandle.seek(page.dataoffsets[tile])
        data = self.tiff.filehandle.read(count)
        if int(page.compression) in STORED_TILE_COMPRESSIONS:
            return as_rgb(stored_tile(page, data))
        segment, _, _ = page.decode(data, tile, jpegtables=page.jpegtables)
        if segment is None:
            return None
        return as_rgb(np.asarray(segment)[0])

    def region(self, region: Region) -> Rgb | None:
        page = self.pages[region.level]
        out = np.full((region.height, region.width, 3), WHITE, dtype=np.uint8)
        across = -(-page.imagewidth // page.tilewidth)
        found = False
        for row, column in grid(
            region, page.tilewidth, page.tilelength, page.imagewidth, page.imagelength
        ):
            index = row * across + column
            tile = self.tiles.get((region.level, index), self.decoded)
            if tile is None:
                continue
            found = True
            x0, y0 = column * page.tilewidth, row * page.tilelength
            visible = tile[: page.imagelength - y0, : page.imagewidth - x0]
            paste(out, visible, x0, y0, region)
        return out if found else None

    def close(self) -> None:
        self.tiff.close()


@dataclass(frozen=True)
class ZarrLevel:
    folder: Path
    layout: ArrayLayout
    width: int
    height: int
    chunk_width: int
    chunk_height: int
    codec: str
    fill: int


def zarr_level(folder: Path) -> ZarrLevel:
    layout = array_layout(folder, 3)
    if layout.shard is not None:
        raise UnsupportedZarrError("sharded stores are not served as patches yet")
    meta = read_json(folder / "zarr.json")
    if meta.get("data_type") != "uint8":
        raise UnsupportedZarrError("the patch service reads 8-bit brightfield stores")
    channels, height, width = layout.shape
    chunk_channels, chunk_height, chunk_width = layout.chunks
    if channels != 3 or chunk_channels != 3:
        raise UnsupportedZarrError("the patch service reads three-channel stores")
    names = [codec["name"] for codec in meta["codecs"]]
    codec = next((name for name in names if name in {"zstd", ZARR_JPEG}), None)
    if codec is None:
        raise UnsupportedZarrError(f"unsupported zarr codecs {names}")
    return ZarrLevel(
        folder, layout, width, height, chunk_width, chunk_height, codec, int(meta["fill_value"])
    )


class ZarrSource:
    def __init__(self, store: Path, cache: int) -> None:
        version, attributes = group_attributes(store)
        if version != 3:
            raise UnsupportedZarrError("Zarr version 2 stores are not served as patches yet")
        multiscale = attributes["multiscales"][0]
        datasets = multiscale["datasets"]
        self.arrays = [zarr_level(store / dataset["path"]) for dataset in datasets]
        scales = [
            next(t["scale"] for t in d["coordinateTransformations"] if t["type"] == "scale")
            for d in datasets
        ]
        units = {axis.get("unit") for axis in multiscale["axes"] if axis.get("type") == "space"}
        if units != {"micrometer"}:
            raise UncalibratedError("the store has no micrometre scale")
        self.mpp = float(scales[0][-1])
        self.levels = tuple(
            SourceLevel(array.width, array.height, float(scale[-1]) / self.mpp)
            for array, scale in zip(self.arrays, scales, strict=True)
        )
        self.chunks: LruCache[tuple[int, int, int], Rgb | None] = LruCache(cache)

    def decoded(self, key: tuple[int, int, int]) -> Rgb | None:
        level, row, column = key
        array = self.arrays[level]
        path = chunk_path(array.folder, array.layout, (0, row, column))
        if not path.exists():
            return None
        body = path.read_bytes()
        if array.codec == ZARR_JPEG:
            with Image.open(io.BytesIO(body)) as image:
                return np.asarray(image.convert("RGB"))
        planes = np.frombuffer(zstd.decompress(body), dtype=np.uint8)
        return np.ascontiguousarray(
            planes.reshape(3, array.chunk_height, array.chunk_width).transpose(1, 2, 0)
        )

    def region(self, region: Region) -> Rgb | None:
        array = self.arrays[region.level]
        out = np.full((region.height, region.width, 3), array.fill, dtype=np.uint8)
        found = False
        for row, column in grid(
            region, array.chunk_width, array.chunk_height, array.width, array.height
        ):
            chunk = self.chunks.get((region.level, row, column), self.decoded)
            if chunk is None:
                continue
            found = True
            visible = chunk[
                : array.height - row * array.chunk_height,
                : array.width - column * array.chunk_width,
            ]
            paste(out, visible, column * array.chunk_width, row * array.chunk_height, region)
        return out if found else None

    def close(self) -> None:
        self.chunks.clear()


def tiled_stored(path: Path) -> bool:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            return False
        for level in series.levels:
            page = level.keyframe
            if not isinstance(page, tifffile.TiffPage) or not page.is_tiled:
                return False
            if int(page.compression) not in STORED_TILE_COMPRESSIONS or page.samplesperpixel != 3:
                return False
    return True


def open_source(path: Path, cache: int = TILE_CACHE) -> PatchSource:
    if path.is_dir():
        return ZarrSource(path, cache)
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    if found.format is None:
        raise ValueError(f"{path.name} is not a readable slide")
    pyramid = read_pyramid(path, found)
    if not isinstance(pyramid, Pyramid):
        raise ValueError(f"{path.name} has no pyramid")
    mpp = pyramid.scale.mpp_x
    if mpp is None:
        raise UncalibratedError(f"{path.name} has no microns per pixel")
    if pyramid.reader is Reader.TIFFFILE or (
        found.format is Format.APERIO_SVS and tiled_stored(path)
    ):
        return TiledTiffSource(path, mpp, cache)
    if pyramid.reader is Reader.OPENSLIDE:
        return OpenSlideSource(path, mpp)
    raise ValueError(f"{pyramid.reader} slides are not served as patches yet")


def plan(source: PatchSource, x: float, y: float, microns: float, size: int) -> Plan:
    target = microns / size
    usable = [
        index
        for index, level in enumerate(source.levels)
        if source.mpp * level.downsample <= target * LEVEL_TOLERANCE
    ]
    index = max(usable, key=lambda k: source.levels[k].downsample) if usable else 0
    downsample = source.levels[index].downsample
    half = microns / source.mpp / 2
    x0, y0 = (x - half) / downsample, (y - half) / downsample
    x1, y1 = (x + half) / downsample, (y + half) / downsample
    left, top = math.floor(x0), math.floor(y0)
    width = max(1, math.ceil(x1) - left)
    height = max(1, math.ceil(y1) - top)
    crop = (x0 - left, y0 - top, x1 - left, y1 - top)
    return Plan(Region(index, left, top, width, height), size, crop)


def resized(pixels: Rgb, chosen: Plan) -> Rgb:
    size = chosen.size
    if pixels.shape[:2] == (size, size) and chosen.crop == (0, 0, size, size):
        return pixels
    image = Image.fromarray(pixels).resize((size, size), Image.Resampling.BOX, box=chosen.crop)
    return np.asarray(image)


class PatchService:
    def __init__(self, cache: int = TILE_CACHE, slides: int = OPEN_SLIDES) -> None:
        self.cache = cache
        self.sources: LruCache[Path, PatchSource] = LruCache(slides)

    def source(self, path: Path) -> PatchSource:
        return self.sources.get(path.resolve(), self.opened)

    def opened(self, path: Path) -> PatchSource:
        return open_source(path, self.cache)

    def patch(
        self,
        path: Path,
        x: float,
        y: float,
        microns: float = PATCH_MICRONS,
        size: int = PATCH_SIZE,
    ) -> Rgb | None:
        source = self.source(path)
        chosen = plan(source, x, y, microns, size)
        pixels = source.region(chosen.region)
        return None if pixels is None else resized(pixels, chosen)

    def close(self) -> None:
        self.sources.clear()
