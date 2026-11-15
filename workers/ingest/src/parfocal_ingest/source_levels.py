import io
import struct
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
import openslide
import tifffile
from numpy.lib.format import open_memmap
from PIL import Image

from parfocal_ingest.identify import Format
from parfocal_ingest.pyramid import Level, Pyramid, Reader, children, main_series
from parfocal_ingest.thumbnail import background_of, flattened

READ_BLOCK = 2048
APERIO_JPEG2000_YCBCR = 33003
APERIO_JPEG2000_RGB = 33005
SIZ_MARKER = b"\xff\x51"
SRGB_COLOURSPACE = 16
EIGHT_BITS = 7
SCALE_BITS = 16
HALF = 1 << (SCALE_BITS - 1)
CHROMA = np.arange(256, dtype=np.int64) - 128


def fixed(factor: float) -> int:
    return int(factor * (1 << SCALE_BITS) + 0.5)


RED_FROM_CR = (fixed(1.402) * CHROMA + HALF) >> SCALE_BITS
GREEN_FROM_CB = -fixed(0.34414) * CHROMA + HALF
GREEN_FROM_CR = -fixed(0.71414) * CHROMA
BLUE_FROM_CB = (fixed(1.772) * CHROMA + HALF) >> SCALE_BITS


class UnconvertibleError(ValueError):
    pass


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


def channel_names(ome: str, image: int) -> list[str]:
    try:
        root = ElementTree.fromstring(ome)
    except ElementTree.ParseError:
        return []
    images = list(children(root, "Image"))
    if image >= len(images):
        return []
    return [channel.get("Name", "") for channel in children(images[image], "Channel")]


def tifffile_names(path: Path) -> list[str]:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            return []
        return channel_names(tiff.ome_metadata or "", tiff.series.index(series))


def tifffile_level(path: Path, index: int, into: Path) -> np.ndarray:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            raise UnconvertibleError("no slide series")
        level = series.levels[index]
        pixels = open_memmap(
            into, mode="w+", dtype=level.dtype.newbyteorder("="), shape=level.shape
        )
        level.asarray(out=pixels)
        pixels.flush()
        return planar(pixels, level.axes)


def openslide_level(path: Path, found: Format, index: int, into: Path) -> np.ndarray:
    with openslide.OpenSlide(path) as slide:
        origin_x = origin_y = 0
        if found is Format.LEICA_SCN:
            origin_x = int(slide.properties.get("openslide.region[0].x", 0))
            origin_y = int(slide.properties.get("openslide.region[0].y", 0))
        step = round(slide.level_downsamples[index])
        width, height = slide.level_dimensions[index]
        background = background_of(slide)
        pixels = open_memmap(into, mode="w+", dtype=np.uint8, shape=(height, width, 3))
        for top in range(0, height, READ_BLOCK):
            for left in range(0, width, READ_BLOCK):
                size = (min(READ_BLOCK, width - left), min(READ_BLOCK, height - top))
                location = (origin_x + left * step, origin_y + top * step)
                region = slide.read_region(location, index, size)
                pixels[top : top + size[1], left : left + size[0]] = np.asarray(
                    flattened(region, background)
                )
        pixels.flush()
    return pixels.transpose(2, 0, 1)


def box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", 8 + len(body)) + kind + body


def jp2_of(codestream: bytes) -> bytes:
    siz = codestream.index(SIZ_MARKER)
    right, bottom, left, top = struct.unpack_from(">IIII", codestream, siz + 6)
    header = box(
        b"ihdr", struct.pack(">IIHBBBB", bottom - top, right - left, 3, EIGHT_BITS, 7, 0, 0)
    )
    colour = box(b"colr", struct.pack(">BBBI", 1, 0, 0, SRGB_COLOURSPACE))
    return (
        box(b"jP  ", b"\r\n\x87\n")
        + box(b"ftyp", b"jp2 " + struct.pack(">I", 0) + b"jp2 ")
        + box(b"jp2h", header + colour)
        + box(b"jp2c", codestream)
    )


def ycbcr_to_rgb(pixels: np.ndarray) -> np.ndarray:
    luma = pixels[..., 0].astype(np.int64)
    cb, cr = pixels[..., 1], pixels[..., 2]
    green = (GREEN_FROM_CB[cb] + GREEN_FROM_CR[cr]) >> SCALE_BITS
    rgb = np.stack([luma + RED_FROM_CR[cr], luma + green, luma + BLUE_FROM_CB[cb]], axis=-1)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def jpeg2000_tile(codestream: bytes, ycbcr: bool) -> np.ndarray:
    with Image.open(io.BytesIO(jp2_of(codestream))) as image:
        components = np.asarray(image)
    return ycbcr_to_rgb(components) if ycbcr else components


def aperio_jpeg2000_page(tiff: tifffile.TiffFile, index: int) -> tifffile.TiffPage | None:
    series = main_series(tiff)
    if series is None or index >= len(series.levels):
        return None
    page = series.levels[index].keyframe
    if not isinstance(page, tifffile.TiffPage):
        return None
    if int(page.compression) not in (APERIO_JPEG2000_YCBCR, APERIO_JPEG2000_RGB):
        return None
    return page if page.is_tiled else None


def decode_aperio_tiles(
    tiff: tifffile.TiffFile, page: tifffile.TiffPage, out: np.ndarray, left: int, top: int
) -> bool:
    height, width = out.shape[:2]
    tile_width, tile_height = page.tilewidth, page.tilelength
    across = -(-page.imagewidth // tile_width)
    ycbcr = int(page.compression) == APERIO_JPEG2000_YCBCR
    for row in range(top // tile_height, -(-(top + height) // tile_height)):
        for column in range(left // tile_width, -(-(left + width) // tile_width)):
            tile = row * across + column
            count = page.databytecounts[tile]
            if count == 0:
                return False
            tiff.filehandle.seek(page.dataoffsets[tile])
            try:
                decoded = jpeg2000_tile(tiff.filehandle.read(count), ycbcr)
            except ValueError, OSError, struct.error:
                return False
            x0, y0 = column * tile_width, row * tile_height
            x1, y1 = max(x0, left), max(y0, top)
            x2 = min(x0 + decoded.shape[1], left + width)
            y2 = min(y0 + decoded.shape[0], top + height)
            out[y1 - top : y2 - top, x1 - left : x2 - left] = decoded[
                y1 - y0 : y2 - y0, x1 - x0 : x2 - x0
            ]
    return True


def aperio_jpeg2000_window(
    path: Path, index: int, left: int, top: int, width: int, height: int
) -> np.ndarray | None:
    with tifffile.TiffFile(path) as tiff:
        page = aperio_jpeg2000_page(tiff, index)
        if page is None:
            return None
        if left < 0 or top < 0:
            return None
        if left + width > page.imagewidth or top + height > page.imagelength:
            return None
        pixels = np.zeros((height, width, 3), dtype=np.uint8)
        return pixels if decode_aperio_tiles(tiff, page, pixels, left, top) else None


def aperio_jpeg2000_level(path: Path, index: int, into: Path) -> np.ndarray | None:
    with tifffile.TiffFile(path) as tiff:
        page = aperio_jpeg2000_page(tiff, index)
        if page is None:
            return None
        shape = (page.imagelength, page.imagewidth, 3)
        pixels = open_memmap(into, mode="w+", dtype=np.uint8, shape=shape)
        if not decode_aperio_tiles(tiff, page, pixels, 0, 0):
            return None
        pixels.flush()
    return pixels.transpose(2, 0, 1)


def source_level(
    path: Path, found: Format, pyramid: Pyramid, level: Level, into: Path
) -> np.ndarray | None:
    match pyramid.reader:
        case Reader.TIFFFILE:
            return tifffile_level(path, level.index, into)
        case Reader.WSIDICOM:
            raise UnconvertibleError("DICOM slides are not converted")
        case Reader.OPENSLIDE:
            with openslide.OpenSlide(path) as slide:
                downsamples = slide.level_downsamples
                dimensions = slide.level_dimensions
            index = min(
                range(len(downsamples)), key=lambda k: abs(downsamples[k] - level.downsample)
            )
            if round(downsamples[index]) != level.downsample:
                return None
            if downsamples[index] == level.downsample:
                return openslide_level(path, found, index, into)
            if found is Format.APERIO_SVS:
                read = aperio_jpeg2000_level(path, level.index, into)
                if read is not None and read.shape[1:] == dimensions[index][::-1]:
                    return read
            return None
