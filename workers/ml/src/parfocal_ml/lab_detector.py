import asyncio
import io
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from parfocal_common.chunk_store import Cell
from parfocal_common.jobs import StepFailedError
from parfocal_common.lab_model_call import (
    Answer,
    CallRefusedError,
    Endpoint,
    SentObject,
    SentTile,
    call_endpoint,
)
from parfocal_common.link_fetch import LinkPolicy
from parfocal_ml.nuclei import RegionReader
from parfocal_ml.whole_slide import Window

MICRONS_AT_ONE_TIMES = 10.0
RETRIES = 2
RETRY_PAUSE_SECONDS = 2.0
CALL_TIMEOUT_SECONDS = 60.0
CHANGED = "lab-model-changed"
OFF_CONTRACT = "lab-model-contract"
BLANK = 255


@dataclass(frozen=True)
class LabModelSpec:
    name: str
    version: str
    endpoint: Endpoint
    tile_size: int
    magnification: int
    class_map: Mapping[str, str | None]
    classes: tuple[str, ...]

    def class_index(self, sent: str) -> int | None:
        becomes = self.class_map.get(sent)
        if becomes is None or becomes not in self.classes:
            return None
        return self.classes.index(becomes)


def refusal_code(error: CallRefusedError) -> str:
    return f"lab-model-{error.code.value}"


def level_zero_scale(slide_mpp: float, magnification: int) -> float:
    return (MICRONS_AT_ONE_TIMES / magnification) / slide_mpp


def lab_tile_core(slide_mpp: float, spec: LabModelSpec) -> int:
    return max(1, round(spec.tile_size * level_zero_scale(slide_mpp, spec.magnification)))


def png_of(rgb: np.ndarray, size: int) -> bytes:
    square = np.full((size, size, 3), BLANK, dtype=np.uint8)
    height, width = min(size, rgb.shape[0]), min(size, rgb.shape[1])
    square[:height, :width] = rgb[:height, :width, :3]
    buffer = io.BytesIO()
    Image.fromarray(square).save(buffer, format="PNG")
    return buffer.getvalue()


def clipped(ring: Sequence[tuple[float, float]], window: Window) -> list[float]:
    flat: list[float] = []
    for x, y in ring:
        flat.append(min(max(float(x), window.x), window.right))
        flat.append(min(max(float(y), window.y), window.bottom))
    if len(flat) > 2 and flat[:2] == flat[-2:]:
        flat = flat[:-2]
    return flat


@dataclass(frozen=True)
class Region:
    class_index: int
    ring: list[float]


@dataclass
class LabDetector:
    spec: LabModelSpec
    reader: RegionReader
    policy: LinkPolicy
    pause: Callable[[float], Awaitable[None]] = asyncio.sleep
    timeout_seconds: float = CALL_TIMEOUT_SECONDS
    answered: tuple[str, str] | None = None
    regions_left_out: int = 0
    classes_left_out: int = 0
    classes: int = field(init=False)
    regions: dict[Window, list[Region]] = field(default_factory=dict[Window, list[Region]])

    def __post_init__(self) -> None:
        self.classes = len(self.spec.classes)

    async def call(self, tile: SentTile) -> Answer:
        return await call_endpoint(
            self.spec.endpoint,
            self.policy,
            self.timeout_seconds,
            self.spec.tile_size,
            self.spec.magnification,
            tile,
        )

    async def answer_for(self, tile: SentTile) -> Answer:
        for attempt in range(RETRIES + 1):
            try:
                return await self.call(tile)
            except CallRefusedError as error:
                if attempt == RETRIES:
                    raise StepFailedError(refusal_code(error)) from error
                await self.pause(RETRY_PAUSE_SECONDS * (attempt + 1))
        raise AssertionError

    def check_identity(self, answer: Answer) -> None:
        if answer.model_name is None or answer.model_version is None:
            raise StepFailedError(OFF_CONTRACT)
        identity = (answer.model_name, answer.model_version)
        if self.answered is None:
            self.answered = identity
        elif identity != self.answered:
            raise StepFailedError(CHANGED)

    def region_of(self, item: SentObject, window: Window) -> Region | None:
        index = self.spec.class_index(item.name)
        ring = clipped(item.ring, window)
        if index is None or len(ring) < 6:
            self.regions_left_out += 1
            return None
        return Region(index, ring)

    def take_regions(self, window: Window) -> list[Region]:
        return self.regions.pop(window, [])

    def cell_of(self, item: SentObject, window: Window) -> Cell | None:
        index = self.spec.class_index(item.name)
        if index is None:
            self.classes_left_out += 1
            return None
        ring = clipped(item.ring, window)
        if len(ring) < 6:
            return None
        return Cell(1, ring, class_index=index)

    async def detect(self, window: Window) -> Sequence[Cell]:
        scale = level_zero_scale(self.reader.mpp, self.spec.magnification)
        size = self.spec.tile_size
        width = min(size, max(1, round(window.width / scale)))
        height = min(size, max(1, round(window.height / scale)))
        rgb = await self.reader.read(window, width, height)
        tile = SentTile(await asyncio.to_thread(png_of, rgb, size), (window.x, window.y))
        answer = await self.answer_for(tile)
        self.check_identity(answer)
        cells = [self.cell_of(item, window) for item in answer.objects if item.kind == "cell"]
        regions = [self.region_of(item, window) for item in answer.objects if item.kind != "cell"]
        self.regions[window] = [region for region in regions if region is not None]
        return [cell for cell in cells if cell is not None]
