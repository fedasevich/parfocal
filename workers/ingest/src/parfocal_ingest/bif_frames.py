from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import tifffile

XMP_TAG = 700
LEVEL_SIZE_SLACK = 1

IMAGE_INFO = re.compile(r"<ImageInfo\s[^>]*>")
TILE_JOINT = re.compile(r"<TileJointInfo\s([^>]*?)/>")


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


def layout(
    columns: int,
    rows: int,
    frame_width: int,
    frame_height: int,
    column_x: Sequence[float],
    row_y: Sequence[float],
    advance_x: float,
    advance_y: float,
) -> dict[str, Any]:
    return {
        "columns": columns,
        "rows": rows,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "columnX": [round(x, 3) for x in column_x],
        "rowY": [round(y, 3) for y in row_y],
        "advanceX": round(advance_x, 6),
        "advanceY": round(advance_y, 6),
        "width": math.ceil(column_x[-1] + frame_width),
        "height": math.ceil(row_y[-1] + frame_height),
    }


def plain_grid(width: int, height: int, frame_width: int, frame_height: int) -> dict[str, Any]:
    columns = math.ceil(width / frame_width)
    rows = math.ceil(height / frame_height)
    placed = layout(
        columns,
        rows,
        frame_width,
        frame_height,
        [float(column * frame_width) for column in range(columns)],
        [float(row * frame_height) for row in range(rows)],
        frame_width,
        frame_height,
    )
    return {**placed, "width": width, "height": height}


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
    for body in TILE_JOINT.findall(xmp):
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
    if (columns > 1 and whole_across.weight <= 0) or (rows > 1 and whole_down.weight <= 0):
        return None
    mean_across = whole_across.overlap(0.0)
    mean_down = whole_down.overlap(0.0)
    return layout(
        columns,
        rows,
        frame_width,
        frame_height,
        positions(frame_width, [b.overlap(mean_across) for b in across[: columns - 1]]),
        positions(frame_height, [b.overlap(mean_down) for b in down[: rows - 1]]),
        frame_width - mean_across,
        frame_height - mean_down,
    )


def xmp_of(page: tifffile.TiffPage) -> str | None:
    tag = page.tags.get(XMP_TAG)
    value = None if tag is None else tag.value
    if value is None:
        return None
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)


def placed_extent(stitching: dict[str, Any]) -> tuple[int, int]:
    return (
        math.ceil((stitching["columns"] - 1) * stitching["advanceX"] + stitching["frameWidth"]),
        math.ceil((stitching["rows"] - 1) * stitching["advanceY"] + stitching["frameHeight"]),
    )


def frame_placement(
    page: tifffile.TiffPage, openslide_size: tuple[int, int] | None = None
) -> dict[str, Any] | None:
    frame_width, frame_height = page.tilewidth, page.tilelength
    if frame_width < 1 or frame_height < 1:
        return None
    xmp = xmp_of(page)
    if xmp is None:
        stitching = plain_grid(page.imagewidth, page.imagelength, frame_width, frame_height)
        extent = (stitching["width"], stitching["height"])
    else:
        found = bif_stitching(xmp, frame_width, frame_height)
        if found is None:
            return None
        stitching = found
        extent = placed_extent(stitching)
    if openslide_size is not None and any(
        abs(ours - theirs) > LEVEL_SIZE_SLACK
        for ours, theirs in zip(extent, openslide_size, strict=True)
    ):
        return None
    return stitching
