import base64
import struct
import uuid
import zlib
from dataclasses import dataclass

from fastapi import APIRouter, Response
from pydantic import BaseModel

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.slide_coverage import (
    BASE_CELL,
    CoverageGrid,
    bitset_bytes,
    readable_slide,
    seen_count,
    slide_grid,
)
from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import StorageError

TISSUE_FILE = "tissue.png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TISSUE_HEADERS = {"Cache-Control": "private, max-age=3600"}


class SlideTissue(BaseModel):
    slide_id: uuid.UUID
    grid: CoverageGrid
    tissue: str
    tissue_cells: int


class TissueMaskMissingError(NotFoundError):
    code = "tissue-mask-missing"
    title = "This slide has no stored tissue mask yet"


class TissueMaskUnreadableError(ValueError):
    pass


@dataclass(frozen=True)
class MaskImage:
    width: int
    height: int
    cells: list[bytes]

    def is_tissue(self, column: int, row: int) -> bool:
        return self.cells[row][column] != 0


router = APIRouter(prefix="/api/slides/{slide_id}/tissue", tags=["slides"])


def chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if not data.startswith(PNG_SIGNATURE):
        raise TissueMaskUnreadableError("not a PNG")
    found: list[tuple[bytes, bytes]] = []
    at = len(PNG_SIGNATURE)
    while at + 8 <= len(data):
        (length,) = struct.unpack(">I", data[at : at + 4])
        kind = data[at + 4 : at + 8]
        found.append((kind, data[at + 8 : at + 8 + length]))
        at += 12 + length
        if kind == b"IEND":
            break
    return found


def paeth(left: int, up: int, corner: int) -> int:
    estimate = left + up - corner
    to_left, to_up, to_corner = abs(estimate - left), abs(estimate - up), abs(estimate - corner)
    if to_left <= to_up and to_left <= to_corner:
        return left
    return up if to_up <= to_corner else corner


def unfilter(kind: int, line: bytearray, previous: bytes, step: int) -> bytes:
    for index, value in enumerate(line):
        left = line[index - step] if index >= step else 0
        up = previous[index]
        corner = previous[index - step] if index >= step else 0
        if kind == 1:
            line[index] = (value + left) & 255
        elif kind == 2:
            line[index] = (value + up) & 255
        elif kind == 3:
            line[index] = (value + (left + up) // 2) & 255
        elif kind == 4:
            line[index] = (value + paeth(left, up, corner)) & 255
        elif kind != 0:
            raise TissueMaskUnreadableError("unknown PNG filter")
    return bytes(line)


def read_mask(data: bytes) -> MaskImage:
    found = chunks(data)
    header = next((body for kind, body in found if kind == b"IHDR"), None)
    if header is None or len(header) != 13:
        raise TissueMaskUnreadableError("no PNG header")
    width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", header)
    if colour != 0 or depth not in (1, 8) or interlace != 0:
        raise TissueMaskUnreadableError("the tissue mask is not a plain grey PNG")
    raw = zlib.decompress(b"".join(body for kind, body in found if kind == b"IDAT"))
    stride = (width * depth + 7) // 8
    previous = bytes(stride)
    cells: list[bytes] = []
    for row in range(height):
        start = row * (stride + 1)
        line = unfilter(raw[start], bytearray(raw[start + 1 : start + 1 + stride]), previous, 1)
        previous = line
        if depth == 8:
            cells.append(line)
        else:
            cells.append(bytes((line[x >> 3] >> (7 - (x & 7))) & 1 for x in range(width)))
    return MaskImage(width, height, cells)


def tissue_bits(grid: CoverageGrid, mask: MaskImage, mask_cell: int = BASE_CELL) -> bytes:
    bits = bytearray(bitset_bytes(grid))
    for row in range(mask.height):
        y = (row * mask_cell + mask_cell // 2) // grid.cell
        if y >= grid.rows:
            continue
        for column in range(mask.width):
            if not mask.is_tissue(column, row):
                continue
            x = (column * mask_cell + mask_cell // 2) // grid.cell
            if x < grid.columns:
                index = y * grid.columns + x
                bits[index >> 3] |= 1 << (index & 7)
    return bytes(bits)


@router.get("", operation_id="getSlideTissue", **require(Permission.SEE_SLIDES))
async def get_slide_tissue(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
    response: Response,
) -> SlideTissue:
    row = await readable_slide(connection, principal, slide_id)
    grid = slide_grid(row)
    try:
        stored = await store.get_object(f"{slide_prefix(row.tenant_id, slide_id)}{TISSUE_FILE}")
    except StorageError as error:
        if error.status == 404:
            raise TissueMaskMissingError from error
        raise
    try:
        bits = tissue_bits(grid, read_mask(stored))
    except (TissueMaskUnreadableError, zlib.error, struct.error, IndexError) as error:
        raise TissueMaskMissingError from error
    response.headers.update(TISSUE_HEADERS)
    return SlideTissue(
        slide_id=slide_id,
        grid=grid,
        tissue=base64.b64encode(bits).decode(),
        tissue_cells=seen_count(bits),
    )
