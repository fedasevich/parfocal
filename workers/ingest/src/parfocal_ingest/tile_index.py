import base64
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import tifffile

from parfocal_ingest.bif_frames import Unplaced, frame_placement
from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.pyramid import Pyramid, main_series

VERSION = 1
JPEG_TABLES_TAG = 347
ARGOS_METADATA_TAG = 65000

TIFF_FAMILY = frozenset(
    {
        Format.APERIO_SVS,
        Format.HAMAMATSU_NDPI,
        Format.LEICA_SCN,
        Format.VENTANA_BIF,
        Format.PHILIPS_TIFF,
        Format.HURON_TIFF,
        Format.ARGOS_AVS,
        Format.OME_TIFF,
        Format.GENERIC_TIFF,
    }
)

ARGOS_LOWEST_PLANE = re.compile(r"<MinZ>\s*(-?\d+)\s*</MinZ>")
ARGOS_HIGHEST_PLANE = re.compile(r"<MaxZ>\s*(-?\d+)\s*</MaxZ>")


type PageName = tuple[int, int | None]


def tile_kind(found: Format) -> str:
    if found is Format.HAMAMATSU_NDPI:
        return "ndpi-restart"
    if found is Format.VENTANA_BIF:
        return "bif-frames"
    return "grid"


def page_names(tiff: tifffile.TiffFile) -> dict[int, PageName]:
    names: dict[int, PageName] = {}
    for ifd, page in enumerate(tiff.pages):
        assert page is not None
        names[page.offset] = (ifd, None)
        for sub, offset in enumerate(getattr(page, "subifds", None) or ()):
            names[offset] = (ifd, sub)
    return names


def offset_gaps(offsets: Sequence[int], counts: Sequence[int]) -> list[int]:
    gaps: list[int] = []
    end = 0
    for offset, count in zip(offsets, counts, strict=True):
        gaps.append(int(offset) - end)
        end = int(offset) + int(count)
    return gaps


def header_of(page: tifffile.TiffPage, found: Format) -> str | None:
    header = page.jpegheader if found is Format.HAMAMATSU_NDPI else page.jpegtables
    return base64.b64encode(header).decode() if header else None


def argos_focused_plane(metadata: str) -> int:
    lowest = ARGOS_LOWEST_PLANE.search(metadata)
    highest = ARGOS_HIGHEST_PLANE.search(metadata)
    if "<Argos.Scan.Metadata>" not in metadata or lowest is None or highest is None:
        return 0
    if int(lowest.group(1)) > 0 or int(highest.group(1)) < 0:
        return 0
    return -int(lowest.group(1))


def shown_pages(
    tiff: tifffile.TiffFile, chosen: Format, pages: list[tifffile.TiffPage | tifffile.TiffFrame]
) -> list[tifffile.TiffPage | tifffile.TiffFrame]:
    if chosen is not Format.ARGOS_AVS or len(pages) < 2:
        return pages
    first = tiff.pages[0]
    assert isinstance(first, tifffile.TiffPage)
    tag = first.tags.get(ARGOS_METADATA_TAG)
    value = None if tag is None else tag.value
    metadata = value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value or "")
    plane = argos_focused_plane(metadata)
    return [pages[plane] if plane < len(pages) else pages[0]]


def page_entry(
    page: tifffile.TiffPage | tifffile.TiffFrame, names: dict[int, PageName]
) -> dict[str, Any]:
    ifd, sub = names[page.offset]
    counts = [int(count) for count in page.databytecounts]
    return {
        "page": ifd,
        "subIfd": sub,
        "ifdOffset": page.offset,
        "tileOffsetGaps": offset_gaps(page.dataoffsets, counts),
        "tileByteCounts": counts,
    }


def microns_per_pixel(found: Pyramid) -> dict[str, float] | None:
    x, y = found.scale.mpp_x, found.scale.mpp_y
    return None if x is None or y is None else {"x": x, "y": y}


def tile_index(path: Path, identified: Identified, found: Pyramid) -> dict[str, Any] | None:
    chosen = identified.format
    if chosen is None or chosen not in TIFF_FAMILY or identified.variant == "zip":
        return None
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            return None
        names = page_names(tiff)
        levels: list[dict[str, Any]] = []
        for level in found.levels:
            stored = [page for page in series.levels[level.index].pages if page is not None]
            pages = shown_pages(tiff, chosen, stored)
            keyframe = pages[0]
            assert isinstance(keyframe, tifffile.TiffPage)
            levels.append(
                {
                    **page_entry(keyframe, names),
                    "downsample": level.downsample,
                    "width": level.width,
                    "height": level.height,
                    "tileWidth": keyframe.tilewidth or keyframe.imagewidth,
                    "tileHeight": keyframe.tilelength or keyframe.rowsperstrip,
                    "jpegHeader": header_of(keyframe, chosen),
                    "siblings": [page_entry(page, names) for page in pages[1:]],
                }
            )
        document: dict[str, Any] = {
            "version": VERSION,
            "formatId": chosen.value,
            "tileKind": tile_kind(chosen),
            "littleEndian": tiff.byteorder == "<",
            "bigTiff": tiff.is_bigtiff,
            "micronsPerPixel": microns_per_pixel(found),
            "levels": levels,
        }
        if chosen is Format.VENTANA_BIF:
            base = series.levels[found.levels[0].index].keyframe
            assert isinstance(base, tifffile.TiffPage)
            placement = frame_placement(base, (found.levels[0].width, found.levels[0].height))
            if isinstance(placement, Unplaced):
                document["stitching"] = None
                document["unplaced"] = placement.value
            else:
                document["stitching"] = placement
        return document


def index_document(document: dict[str, Any]) -> bytes:
    return json.dumps(document, separators=(",", ":")).encode()
