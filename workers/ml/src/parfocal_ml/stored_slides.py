import asyncio
import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np

from parfocal_common.ingest import slide_prefix
from parfocal_common.jobs import StepFailedError
from parfocal_common.object_store import ObjectStore
from parfocal_ml.tumor_map import Rgb
from parfocal_ml.tumor_map_job import SlideImage

LEVELS_NAME = "levels.json"
ORIGINAL_STEM = "original"
OPENSLIDE_SUFFIXES = frozenset(
    {".svs", ".tif", ".tiff", ".ndpi", ".scn", ".bif", ".vms", ".svslide"}
)
THUMBNAIL_DOWNSAMPLE = 32
STRIP_ROWS = 512
WHITE = 255
MISSING = "tumor-map-slide-missing"
UNREADABLE = "tumor-map-unreadable-slide"
PART_SUFFIX = ".part"


@dataclass(frozen=True)
class LevelTable:
    width: int
    height: int
    mpp: float | None
    level_count: int


def level_table(data: bytes) -> LevelTable:
    table = json.loads(data)
    levels = table["levels"]
    base = levels[0]
    mpp = table.get("scale", {}).get("mpp_x")
    return LevelTable(int(base["width"]), int(base["height"]), mpp, len(levels))


def flattened(rgba: Any) -> Rgb:
    pixels = np.asarray(rgba)
    rgb = pixels[..., :3].copy()
    rgb[pixels[..., 3] == 0] = WHITE
    return rgb


class OpenSlideRegions:
    def __init__(self, slide: Any) -> None:
        self.slide = slide

    def read(self, x: int, y: int, width: int, height: int) -> Rgb:
        return flattened(self.slide.read_region((int(x), int(y)), 0, (int(width), int(height))))


def thumbnail_of(slide: Any, target: int = THUMBNAIL_DOWNSAMPLE) -> tuple[Rgb, float]:
    level = slide.get_best_level_for_downsample(target + 0.5)
    level_downsample = float(slide.level_downsamples[level])
    step = max(1, int(target // level_downsample))
    width, height = slide.level_dimensions[level]
    strip = STRIP_ROWS * step
    strips = []
    for top in range(0, height, strip):
        rows = min(strip, height - top)
        origin = (0, round(top * level_downsample))
        strips.append(flattened(slide.read_region(origin, level, (width, rows)))[::step, ::step])
    return np.concatenate(strips), level_downsample * step


def original_name(keys: list[str], prefix: str) -> str | None:
    for key in keys:
        name = key.removeprefix(prefix)
        if "/" not in name and PurePosixPath(name).stem == ORIGINAL_STEM:
            return name
    return None


def opened(path: Path, table: LevelTable) -> SlideImage:
    import openslide

    try:
        slide = openslide.OpenSlide(str(path))
    except openslide.OpenSlideError as error:
        raise StepFailedError(UNREADABLE) from error
    if tuple(slide.dimensions) != (table.width, table.height):
        raise StepFailedError(UNREADABLE)
    thumbnail, downsample = thumbnail_of(slide)
    return SlideImage(
        reader=OpenSlideRegions(slide),
        thumbnail=thumbnail,
        downsample=downsample,
        width=table.width,
        height=table.height,
        mpp=table.mpp,
        level_count=table.level_count,
    )


class StoredSlides:
    def __init__(self, storage: ObjectStore, folder: Path) -> None:
        self.storage = storage
        self.folder = folder
        self.held: tuple[uuid.UUID, uuid.UUID, SlideImage] | None = None

    async def open(self, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> SlideImage:
        if self.held is not None and self.held[:2] == (tenant_id, slide_id):
            return self.held[2]
        self.close()
        prefix = slide_prefix(tenant_id, slide_id)
        name = original_name(await self.storage.list_keys(prefix), prefix)
        if name is None:
            raise StepFailedError(MISSING)
        if PurePosixPath(name).suffix.lower() not in OPENSLIDE_SUFFIXES:
            raise StepFailedError(UNREADABLE)
        table = level_table(await self.storage.get_object(f"{prefix}{LEVELS_NAME}"))
        target = self.folder / str(tenant_id) / str(slide_id) / name
        await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
        partial = target.with_name(target.name + PART_SUFFIX)
        await self.storage.download(f"{prefix}{name}", partial)
        await asyncio.to_thread(partial.replace, target)
        slide = await asyncio.to_thread(opened, target, table)
        self.held = (tenant_id, slide_id, slide)
        return slide

    def close(self) -> None:
        if self.held is None:
            return
        tenant_id, slide_id, slide = self.held
        reader = slide.reader
        if isinstance(reader, OpenSlideRegions):
            reader.slide.close()
        shutil.rmtree(self.folder / str(tenant_id) / str(slide_id), ignore_errors=True)
        self.held = None
