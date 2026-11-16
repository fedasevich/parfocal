import math
import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from parfocal_common.tumor_maps import MODEL, MODEL_VERSION

KIND = "view-map"
CELL = 256
TILE_CELLS = 16
TILE_SPAN = CELL * TILE_CELLS
__all__ = ["CELL", "KIND", "MODEL", "MODEL_VERSION", "TILE_CELLS", "TILE_SPAN"]


@dataclass(frozen=True)
class ViewTile:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    column: int
    row: int

    def call(self) -> dict[str, object]:
        return {
            "kind": KIND,
            "tenant_id": str(self.tenant_id),
            "slide_id": str(self.slide_id),
            "column": self.column,
            "row": self.row,
        }


class ViewTileCallError(ValueError):
    pass


def view_tile_of(call: Mapping[str, object]) -> ViewTile:
    column, row = call.get("column"), call.get("row")
    if call.get("kind") != KIND or not isinstance(column, int) or not isinstance(row, int):
        raise ViewTileCallError("A view map call names its kind, column and row")
    return ViewTile(
        uuid.UUID(str(call.get("tenant_id"))), uuid.UUID(str(call.get("slide_id"))), column, row
    )


def tile_grid(width: int, height: int) -> tuple[int, int]:
    return math.ceil(width / TILE_SPAN), math.ceil(height / TILE_SPAN)


def tile_size(width: int, height: int, column: int, row: int) -> tuple[int, int]:
    cells_across, cells_down = math.ceil(width / CELL), math.ceil(height / CELL)
    return (
        min(TILE_CELLS, cells_across - column * TILE_CELLS),
        min(TILE_CELLS, cells_down - row * TILE_CELLS),
    )


def reply_of(cells: bytes, width: int, height: int) -> dict[str, object]:
    return {"cells": cells, "width": width, "height": height}


def cells_in(reply: Mapping[str, object], width: int, height: int) -> bytes | None:
    cells = reply.get("cells")
    fits = reply.get("width") == width and reply.get("height") == height
    if not isinstance(cells, bytes) or not fits or len(cells) != width * height:
        return None
    return cells
