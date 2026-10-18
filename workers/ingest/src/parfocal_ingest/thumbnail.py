import io
import math
from dataclasses import dataclass
from pathlib import Path

import openslide
import tifffile
from PIL import Image
from wsidicom import WsiDicom

from parfocal_ingest.identify import Format
from parfocal_ingest.pyramid import Level, Pyramid, Reader, main_series

THUMBNAIL_SIDE = 256
OVERVIEW_SIDE = 1024
JPEG_QUALITY = 85
WHITE = (255, 255, 255)


@dataclass(frozen=True)
class Previews:
    thumbnail: bytes
    overview: bytes


def coarsest_level(pyramid: Pyramid, longest: int) -> Level:
    base = pyramid.levels[0]
    needed = max(base.width, base.height) / longest
    usable = [level for level in pyramid.levels if level.downsample <= needed]
    return usable[-1] if usable else base


def target_size(width: int, height: int, longest: int) -> tuple[int, int]:
    scale = min(1.0, longest / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def flattened(image: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    if image.mode == "RGB":
        return image
    if image.mode in {"RGBA", "LA", "PA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, background)
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        return canvas
    return image.convert("RGB")


def background_of(slide: openslide.OpenSlide) -> tuple[int, int, int]:
    value = str(slide.properties.get(openslide.PROPERTY_NAME_BACKGROUND_COLOR) or "FFFFFF")
    try:
        red, green, blue = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return WHITE
    return red, green, blue


def openslide_region(path: Path, found: Format, pyramid: Pyramid, level: Level) -> Image.Image:
    with openslide.OpenSlide(path) as slide:
        properties = slide.properties
        x = y = 0
        if found is Format.LEICA_SCN:
            x = int(properties.get("openslide.region[0].x", 0))
            y = int(properties.get("openslide.region[0].y", 0))
        index = min(
            range(slide.level_count),
            key=lambda k: abs(slide.level_downsamples[k] - level.downsample),
        )
        downsample = slide.level_downsamples[index]
        base = pyramid.levels[0]
        size = (math.ceil(base.width / downsample), math.ceil(base.height / downsample))
        region = slide.read_region((x, y), index, size)
        return flattened(region, background_of(slide))


def dicom_region(path: Path, level: Level) -> Image.Image:
    with WsiDicom.open(path) as slide:
        exponent = int(math.log2(level.downsample))
        image = slide.read_region((0, 0), exponent, (level.width, level.height))
    if not isinstance(image, Image.Image):
        raise TypeError("wsidicom returned an array")
    return flattened(image, WHITE)


def ome_region(path: Path, level: Level) -> Image.Image:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            raise ValueError("no slide series")
        pixels = series.levels[level.index].asarray()
    return flattened(Image.fromarray(pixels[: level.height, : level.width]), WHITE)


def region_for(path: Path, found: Format, pyramid: Pyramid, longest: int) -> Image.Image:
    level = coarsest_level(pyramid, longest)
    match pyramid.reader:
        case Reader.WSIDICOM:
            return dicom_region(path, level)
        case Reader.TIFFSLIDE:
            return ome_region(path, level)
        case Reader.OPENSLIDE:
            return openslide_region(path, found, pyramid, level)


def scaled(image: Image.Image, pyramid: Pyramid, longest: int) -> Image.Image:
    base = pyramid.levels[0]
    return image.resize(target_size(base.width, base.height, longest), Image.Resampling.LANCZOS)


def jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def overview_image(path: Path, found: Format, pyramid: Pyramid) -> Image.Image:
    return scaled(region_for(path, found, pyramid, OVERVIEW_SIDE), pyramid, OVERVIEW_SIDE)


def previews(path: Path, found: Format, pyramid: Pyramid) -> Previews:
    overview = overview_image(path, found, pyramid)
    thumbnail = scaled(overview, pyramid, THUMBNAIL_SIDE)
    return Previews(thumbnail=jpeg(thumbnail), overview=jpeg(overview))
