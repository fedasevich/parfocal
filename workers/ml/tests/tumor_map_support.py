import json
import uuid
from pathlib import Path

import numpy as np
from test_tumor_map import ArraySlide, CentreScorer

from parfocal_ml.tumor_map import CELL, TILE_CELLS
from parfocal_ml.tumor_map_job import SlideImage

DOWNSAMPLE = 16
TISSUE_RED = 60
STORED_SLIDE = "CMU-1-Small-Region.svs"

__all__ = [
    "STORED_SLIDE",
    "CentreScorer",
    "MemoryStore",
    "fixture_red",
    "fixture_slide",
    "levels_json",
    "opener",
]


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


def fixture_red() -> np.ndarray:
    red = np.full((CELL * 40, CELL * (TILE_CELLS + 12)), 255, np.uint8)
    red[CELL * 4 : CELL * 36, CELL * 6 : CELL * 40] = TISSUE_RED
    red[CELL * 10 : CELL * 14, CELL * 20 : CELL * 36] = 20
    return red


def fixture_slide(red: np.ndarray | None = None) -> SlideImage:
    source = ArraySlide(fixture_red() if red is None else red)
    height, width = source.rgb.shape[:2]
    return SlideImage(
        reader=source,
        thumbnail=source.rgb[::DOWNSAMPLE, ::DOWNSAMPLE].copy(),
        downsample=float(DOWNSAMPLE),
        width=width,
        height=height,
        mpp=0.25,
        level_count=8,
    )


def levels_json(path: Path) -> bytes:
    import openslide

    slide = openslide.OpenSlide(str(path))
    levels = [
        {"index": index, "width": width, "height": height}
        for index, (width, height) in enumerate(slide.level_dimensions)
    ]
    mpp = float(slide.properties["openslide.mpp-x"])
    return json.dumps({"levels": levels, "scale": {"mpp_x": mpp}}).encode()


def opener(slide: SlideImage):
    async def open_slide(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> SlideImage:
        return slide

    return open_slide
