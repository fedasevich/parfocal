from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from parfocal_common.view_maps import CELL as VIEW_CELL
from parfocal_common.view_maps import TILE_SPAN, reply_of, tile_size, view_tile_of
from parfocal_ml.tumor_map import CELL, CellBox, Scorer, halve, map_slide, stored_values
from parfocal_ml.tumor_map_job import SlideImage, SlideOpener

JOB_CELLS = TILE_SPAN // CELL
HALVINGS = (VIEW_CELL // CELL).bit_length() - 1

if CELL << HALVINGS != VIEW_CELL or JOB_CELLS * CELL != TILE_SPAN:
    raise RuntimeError("A view map cell must be the job cell doubled a whole number of times")


def view_tile_box(column: int, row: int) -> CellBox:
    left, top = column * JOB_CELLS, row * JOB_CELLS
    return CellBox(left, top, left + JOB_CELLS, top + JOB_CELLS)


def view_tile_values(slide: SlideImage, scorer: Scorer, column: int, row: int) -> NDArray[np.uint8]:
    tissue = slide.tissue()
    box = view_tile_box(column, row)
    tumor_map = map_slide(slide.reader, scorer, tissue, box)
    values = stored_values(tumor_map.probability, tissue)[
        box.top : box.bottom, box.left : box.right
    ]
    for _ in range(HALVINGS):
        values = halve(values)
    width, height = tile_size(slide.width, slide.height, column, row)
    return np.ascontiguousarray(values[:height, :width])


async def answer_view_tile(
    call: Mapping[str, object], open_slide: SlideOpener, scorer: Scorer
) -> dict[str, object]:
    tile = view_tile_of(call)
    slide = await open_slide(tile.tenant_id, tile.slide_id)
    width, height = tile_size(slide.width, slide.height, tile.column, tile.row)
    if width <= 0 or height <= 0:
        raise ValueError(f"View tile {tile.column},{tile.row} is outside the slide")
    values = view_tile_values(slide, scorer, tile.column, tile.row)
    return reply_of(values.tobytes(), width, height)
