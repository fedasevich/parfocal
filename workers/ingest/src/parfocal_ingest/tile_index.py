import base64
import json
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import tifffile

from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.pyramid import Pyramid, main_series

VERSION = 1
XMP_TAG = 700
JPEG_TABLES_TAG = 347

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

IMAGE_INFO = re.compile(r"<ImageInfo\s[^>]*>")
TILE_JOINT = re.compile(r"<TileJointInfo\s([^>]*?)/>")


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


@dataclass(frozen=True)
class Boundary:
    weight: float = 0.0
    total: float = 0.0

    def plus(self, weight: float, overlap: float) -> Boundary:
        return Boundary(self.weight + weight, self.total + weight * overlap)

    def overlap(self, fallback: float) -> float:
        return self.total / self.weight if self.weight > 0 else fallback


def attribute(body: str, name: str) -> float | None:
    match = re.search(rf"\b{name}\s*=\s*[\"']([^\"']*)[\"']", body)
    if match is None:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def frame_cell(frame: int, columns: int, rows: int) -> tuple[int, int] | None:
    if frame < 1 or frame > columns * rows:
        return None
    scan_row, along = divmod(frame - 1, columns)
    column = along if scan_row % 2 == 0 else columns - 1 - along
    return column, rows - 1 - scan_row


def positions(cell: int, overlaps: Sequence[float]) -> list[float]:
    placed = [0.0]
    for overlap in overlaps:
        placed.append(placed[-1] + cell - overlap)
    return placed


def bif_stitching(xmp: str, frame_width: int, frame_height: int) -> dict[str, Any] | None:
    areas = IMAGE_INFO.findall(xmp)
    if len(areas) != 1 or attribute(areas[0], "AOIScanned") == 0:
        return None
    columns = int(attribute(areas[0], "NumCols") or 0)
    rows = int(attribute(areas[0], "NumRows") or 0)
    if columns < 1 or rows < 1:
        return None
    if (attribute(areas[0], "Width"), attribute(areas[0], "Height")) != (frame_width, frame_height):
        return None
    across = [Boundary()] * max(1, columns - 1)
    down = [Boundary()] * max(1, rows - 1)
    whole_across = Boundary()
    whole_down = Boundary()
    joints = TILE_JOINT.findall(xmp)
    for body in joints:
        confidence = attribute(body, "Confidence") or 0
        first = frame_cell(int(attribute(body, "Tile1") or 0), columns, rows)
        second = frame_cell(int(attribute(body, "Tile2") or 0), columns, rows)
        if confidence <= 0 or first is None or second is None:
            continue
        if first[1] == second[1] and abs(first[0] - second[0]) == 1:
            overlap = attribute(body, "OverlapX") or 0
            boundary = min(first[0], second[0])
            across[boundary] = across[boundary].plus(confidence, overlap)
            whole_across = whole_across.plus(confidence, overlap)
        elif first[0] == second[0] and abs(first[1] - second[1]) == 1:
            overlap = attribute(body, "OverlapY") or 0
            boundary = min(first[1], second[1])
            down[boundary] = down[boundary].plus(confidence, overlap)
            whole_down = whole_down.plus(confidence, overlap)
    if not joints:
        return None
    mean_across = whole_across.overlap(0.0)
    mean_down = whole_down.overlap(0.0)
    column_x = positions(frame_width, [b.overlap(mean_across) for b in across[: columns - 1]])
    row_y = positions(frame_height, [b.overlap(mean_down) for b in down[: rows - 1]])
    width = math.ceil(column_x[-1] + frame_width)
    height = math.ceil(row_y[-1] + frame_height)
    if width >= columns * frame_width and height >= rows * frame_height:
        return None
    return {
        "columns": columns,
        "rows": rows,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "columnX": [round(x, 3) for x in column_x],
        "rowY": [round(y, 3) for y in row_y],
        "advanceX": round(frame_width - mean_across, 6),
        "advanceY": round(frame_height - mean_down, 6),
        "width": width,
        "height": height,
    }


def stitching_of(page: tifffile.TiffPage) -> dict[str, Any] | None:
    tag = page.tags.get(XMP_TAG)
    value = None if tag is None else tag.value
    if value is None:
        return None
    xmp = value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)
    return bif_stitching(xmp, page.tilewidth, page.tilelength)


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
            pages = [page for page in series.levels[level.index].pages if page is not None]
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
            document["stitching"] = stitching_of(base)
        return document


def index_document(document: dict[str, Any]) -> bytes:
    return json.dumps(document, separators=(",", ":")).encode()
