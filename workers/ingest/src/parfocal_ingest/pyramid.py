import math
import zipfile
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

import openslide
import tifffile
from wsidicom import WsiDicom
from wsidicom.errors import WsiDicomError

from parfocal_common.ingest import Notice
from parfocal_ingest.identify import Format, Identified, Refusal

USABLE_MPP = 100.0
STANDARD_POWERS = (1.25, 2.5, 5.0, 10.0, 20.0, 40.0)
ASSOCIATED = frozenset({"Thumbnail", "Label", "Macro", "Map", "Overview", "Probability"})
APERIO_YCBCR_JPEG2000 = 33003
COMPRESSIONS = {
    "NONE": "none",
    "JPEG": "jpeg",
    "LZW": "lzw",
    "ADOBE_DEFLATE": "deflate",
    "DEFLATE": "deflate",
    "JPEG2000": "jpeg2000",
    "APERIO_JP2000_YCBC": "jpeg2000",
    "APERIO_JP2000_RGB": "jpeg2000",
    "JPEGXL": "jpegxl",
    "WEBP": "webp",
    "ZSTD": "zstd",
}
PHOTOMETRICS = {"RGB": "rgb", "YCBCR": "ycbcr", "MINISBLACK": "grey", "MINISWHITE": "grey"}
DICOM_COMPRESSIONS = {
    "1.2.840.10008.1.2.1": "none",
    "1.2.840.10008.1.2.4.50": "jpeg",
    "1.2.840.10008.1.2.4.90": "jpeg2000",
    "1.2.840.10008.1.2.4.91": "jpeg2000",
    "1.2.840.10008.1.2.4.201": "htj2k",
    "1.2.840.10008.1.2.4.202": "htj2k",
    "1.2.840.10008.1.2.4.203": "htj2k",
}
DICOM_PHOTOMETRICS = {
    "RGB": "rgb",
    "YBR_FULL": "ycbcr",
    "YBR_FULL_422": "ycbcr",
    "YBR_ICT": "rgb",
    "YBR_RCT": "rgb",
    "MONOCHROME2": "grey",
}
OME_MICRONS = {"µm": 1.0, "um": 1.0, "nm": 0.001, "mm": 1000.0}


class Reader(StrEnum):
    OPENSLIDE = "openslide"
    TIFFSLIDE = "tiffslide"
    WSIDICOM = "wsidicom"


@dataclass(frozen=True)
class Stored:
    width: int
    height: int
    tile_width: int | None
    tile_height: int | None
    compression: str | None
    photometric: str | None


@dataclass(frozen=True)
class Level:
    index: int
    downsample: int
    width: int
    height: int
    stored: Stored


@dataclass(frozen=True)
class Scale:
    mpp_x: float | None
    mpp_y: float | None
    objective_power: float | None
    notices: tuple[Notice, ...]


@dataclass(frozen=True)
class Pyramid:
    reader: Reader
    levels: tuple[Level, ...]
    scale: Scale
    planes: int
    notices: tuple[Notice, ...]


def ceil_to(value: int, step: int) -> int:
    return -(-value // step) * step


def fits(base: int, stored: int, tile: int | None, factor: int) -> bool:
    exact = base / factor
    return math.floor(exact) - 1 <= stored <= ceil_to(math.ceil(exact), tile or 1)


def next_factor(base: Stored, level: Stored, previous: int) -> int | None:
    factor = previous * 2
    while factor <= max(base.width, base.height):
        if fits(base.width, level.width, level.tile_width, factor) and fits(
            base.height, level.height, level.tile_height, factor
        ):
            return factor
        factor *= 2
    return None


def ladder(stored: Sequence[Stored]) -> tuple[tuple[Level, ...], bool]:
    base = stored[0]
    levels = [Level(0, 1, base.width, base.height, base)]
    skipped = False
    for index, level in enumerate(stored[1:], start=1):
        factor = next_factor(base, level, levels[-1].downsample)
        if factor is None:
            skipped = True
            continue
        width = min(level.width, math.ceil(base.width / factor))
        height = min(level.height, math.ceil(base.height / factor))
        levels.append(Level(index, factor, width, height, level))
    return tuple(levels), skipped


def usable(value: float | None) -> float | None:
    return value if value is not None and 0 < value <= USABLE_MPP else None


def nearest_power(mpp: float) -> float:
    return min(STANDARD_POWERS, key=lambda power: abs(math.log(power * mpp / 10)))


def scale_of(mpp_x: float | None, mpp_y: float | None, power: float | None) -> Scale:
    x, y = usable(mpp_x), usable(mpp_y)
    x, y = x or y, y or x
    power = power if power is not None and power > 0 else None
    notices: list[Notice] = []
    if power is None and x is not None and y is not None:
        power = nearest_power(math.sqrt(x * y))
        notices.append(Notice.OBJECTIVE_ESTIMATED)
    elif power is None:
        notices.append(Notice.OBJECTIVE_MISSING)
    if x is None and power is not None:
        x = y = 10 / power
        notices.append(Notice.MPP_ESTIMATED)
    elif x is None:
        notices.append(Notice.MPP_MISSING)
    return Scale(x, y, power, tuple(notices))


def number(value: object) -> float | None:
    try:
        found = float(str(value))
    except ValueError:
        return None
    return found if math.isfinite(found) else None


def pyramid(
    reader: Reader, levels: tuple[Level, ...], scale: Scale, planes: int, skipped: bool
) -> Pyramid:
    notices = list(scale.notices)
    if skipped:
        notices.append(Notice.LEVEL_SKIPPED)
    if planes > 1 and reader is Reader.OPENSLIDE:
        notices.append(Notice.FIRST_PLANE_ONLY)
    return Pyramid(reader, levels, scale, planes, tuple(notices))


def compression_name(page: tifffile.TiffPage) -> str:
    name = str(tifffile.COMPRESSION(page.compression).name)
    return COMPRESSIONS.get(name, name.lower().replace("_", "-"))


def photometric_name(page: tifffile.TiffPage) -> str:
    if int(page.compression) == APERIO_YCBCR_JPEG2000:
        return "ycbcr"
    name = str(tifffile.PHOTOMETRIC(page.photometric).name)
    return PHOTOMETRICS.get(name, name.lower())


def stored_level(level: tifffile.TiffPageSeries) -> Stored:
    page = level.keyframe
    shape, axes = level.shape, level.axes
    return Stored(
        width=shape[axes.index("X")],
        height=shape[axes.index("Y")],
        tile_width=page.tilewidth or None,
        tile_height=page.tilelength or None,
        compression=compression_name(page),
        photometric=photometric_name(page),
    )


def plane_count(series: tifffile.TiffPageSeries) -> int:
    return series.shape[series.axes.index("Z")] if "Z" in series.axes else 1


def area(series: tifffile.TiffPageSeries) -> int:
    base = stored_level(series.levels[0])
    return base.width * base.height


def main_series(tiff: tifffile.TiffFile) -> tifffile.TiffPageSeries | None:
    candidates = [s for s in tiff.series if s.name not in ASSOCIATED and s.levels]
    return max(candidates, key=area) if candidates else None


def local_name(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def children(element: ElementTree.Element, name: str) -> Iterator[ElementTree.Element]:
    return (child for child in element.iter() if local_name(child) == name)


def scn_main_images(description: str) -> int:
    try:
        root = ElementTree.fromstring(description)
    except ElementTree.ParseError:
        return 0
    count = 0
    for collection in children(root, "collection"):
        extent = (collection.get("sizeX"), collection.get("sizeY"))
        for image in children(collection, "image"):
            for view in children(image, "view"):
                if (view.get("sizeX"), view.get("sizeY")) != extent:
                    count += 1
    return count


def ome_scale(tiff: tifffile.TiffFile, image: int) -> Scale:
    try:
        root = ElementTree.fromstring(tiff.ome_metadata or "")
    except ElementTree.ParseError:
        return scale_of(None, None, None)
    images = list(children(root, "Image"))
    pixels = next(children(images[image], "Pixels"), None) if image < len(images) else None
    objective = next(children(root, "Objective"), None)
    power = number(objective.get("NominalMagnification")) if objective is not None else None
    if pixels is None:
        return scale_of(None, None, power)

    def microns(axis: str) -> float | None:
        size = number(pixels.get(f"PhysicalSize{axis}"))
        unit = OME_MICRONS.get(pixels.get(f"PhysicalSize{axis}Unit", "µm"))
        return size * unit if size is not None and unit is not None else None

    return scale_of(microns("X"), microns("Y"), power)


def open_slide(path: Path) -> openslide.OpenSlide | None:
    try:
        return openslide.OpenSlide(path)
    except openslide.OpenSlideError, openslide.OpenSlideUnsupportedFormatError:
        return None


def openslide_scale(slide: openslide.OpenSlide) -> Scale:
    properties = slide.properties
    return scale_of(
        number(properties.get(openslide.PROPERTY_NAME_MPP_X)),
        number(properties.get(openslide.PROPERTY_NAME_MPP_Y)),
        number(properties.get(openslide.PROPERTY_NAME_OBJECTIVE_POWER)),
    )


def stitched(levels: tuple[Level, ...], slide: openslide.OpenSlide) -> tuple[Level, ...]:
    extents = {
        round(downsample): extent
        for downsample, extent in zip(slide.level_downsamples, slide.level_dimensions, strict=True)
    }
    return tuple(
        replace(level, width=extents[level.downsample][0], height=extents[level.downsample][1])
        if level.downsample in extents
        else level
        for level in levels
    )


def tiff_pyramid(path: Path, found: Format) -> Pyramid | Refusal:
    try:
        with tifffile.TiffFile(path) as tiff:
            description = tiff.pages.first.description or ""
            if found is Format.LEICA_SCN and scn_main_images(description) > 1:
                return Refusal.MULTI_REGION
            series = main_series(tiff)
            if series is None:
                return Refusal.NO_PYRAMID
            stored = [stored_level(level) for level in series.levels]
            planes = plane_count(series)
            ome = ome_scale(tiff, tiff.series.index(series)) if found is Format.OME_TIFF else None
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return Refusal.DAMAGED_TIFF
    levels, skipped = ladder(stored)
    if ome is not None:
        return pyramid(Reader.TIFFSLIDE, levels, ome, planes, skipped)
    slide = open_slide(path)
    if slide is None:
        return Refusal.UNREADABLE
    with slide:
        scale = openslide_scale(slide)
        if found is Format.VENTANA_BIF:
            levels = stitched(levels, slide)
    return pyramid(Reader.OPENSLIDE, levels, scale, planes, skipped)


def mirax_pyramid(path: Path) -> Pyramid | Refusal:
    slide = open_slide(path)
    if slide is None:
        return Refusal.UNREADABLE
    with slide:
        properties = slide.properties
        stored = [
            Stored(
                width=width,
                height=height,
                tile_width=None,
                tile_height=None,
                compression=str(
                    properties.get(f"mirax.LAYER_0_LEVEL_{index}_SECTION.IMAGE_FORMAT", "")
                ).lower()
                or None,
                photometric=None,
            )
            for index, (width, height) in enumerate(slide.level_dimensions)
        ]
        scale = openslide_scale(slide)
    levels, skipped = ladder(stored)
    return pyramid(Reader.OPENSLIDE, levels, scale, 1, skipped)


def dicom_power(slide: WsiDicom) -> float | None:
    paths = slide.metadata.pyramid.optical_paths if slide.metadata.pyramid else []
    objective = paths[0].objective if paths else None
    return objective.objective_power if objective is not None else None


def dicom_pyramid(path: Path) -> Pyramid | Refusal:
    try:
        with WsiDicom.open(path) as slide:
            stored: list[Stored] = []
            for level in slide.levels:
                dataset = level.datasets[0]
                stored.append(
                    Stored(
                        width=level.size.width,
                        height=level.size.height,
                        tile_width=level.tile_size.width,
                        tile_height=level.tile_size.height,
                        compression=DICOM_COMPRESSIONS.get(
                            str(level.default_instance.image_data.transfer_syntax)
                        ),
                        photometric=DICOM_PHOTOMETRICS.get(dataset.photometric_interpretation),
                    )
                )
            base = slide.levels[0]
            scale = scale_of(base.mpp.width, base.mpp.height, dicom_power(slide))
            planes = len(base.focal_planes)
    except WsiDicomError, OSError, ValueError, KeyError:
        return Refusal.UNREADABLE
    if not stored:
        return Refusal.NO_PYRAMID
    levels, skipped = ladder(stored)
    return pyramid(Reader.WSIDICOM, levels, scale, planes, skipped)


def safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo] | None:
    members: list[zipfile.ZipInfo] = []
    for member in archive.infolist():
        name = PurePosixPath(member.filename)
        if name.is_absolute() or ".." in name.parts or "\\" in member.filename:
            return None
        if not member.is_dir() and not any(
            part.startswith((".", "__MACOSX")) for part in name.parts
        ):
            members.append(member)
    return members


def unpack(archive: Path, into: Path, found: Format) -> Path | Refusal:
    with zipfile.ZipFile(archive) as opened:
        members = safe_members(opened)
        if members is None:
            return Refusal.ARCHIVE_WITHOUT_SLIDE
        for member in members:
            opened.extract(member, into)
    names = [PurePosixPath(member.filename) for member in members]
    if found is Format.MIRAX:
        slides = [name for name in names if name.suffix.lower() == ".mrxs"]
        return into / slides[0] if len(slides) == 1 else Refusal.ARCHIVE_WITHOUT_SLIDE
    folders = {name.parent for name in names}
    return into / folders.pop() if len(folders) == 1 else Refusal.ARCHIVE_WITHOUT_SLIDE


def read_pyramid(path: Path, identified: Identified) -> Pyramid | Refusal:
    match identified.format:
        case None:
            return identified.refusal or Refusal.UNKNOWN
        case Format.MIRAX:
            return mirax_pyramid(path)
        case Format.DICOM:
            return dicom_pyramid(path)
        case found:
            return tiff_pyramid(path, found)
