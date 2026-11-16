import asyncio

import numpy as np
from tumor_map_support import TISSUE_RED, CentreScorer, fixture_slide, opener

from parfocal_common.view_maps import TILE_SPAN
from parfocal_ml.tumor_map import CELL
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.view_map import answer_view_tile

WIDTH = TILE_SPAN
HEIGHT = TILE_SPAN + 8 * CELL

__all__ = ["HEIGHT", "WIDTH", "StandInPools", "view_slide"]


def view_red() -> np.ndarray:
    red = np.full((HEIGHT, WIDTH), 255, np.uint8)
    red[CELL * 4 : CELL * 70, CELL * 6 : CELL * 58] = TISSUE_RED
    red[CELL * 10 : CELL * 30, CELL * 20 : CELL * 36] = 20
    return red


def view_slide() -> SlideImage:
    return fixture_slide(view_red())


class StandInPools:
    def __init__(self, slide: SlideImage | None = None) -> None:
        self.slide = slide or view_slide()
        self.calls: list[tuple[str, dict[str, object]]] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.calls.append((function_name, call))

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        self.calls.append((function_name, call))
        return asyncio.run(answer_view_tile(call, opener(self.slide), CentreScorer()))
