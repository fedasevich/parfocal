import asyncio
import csv
import io
import json
import math
import shutil
import uuid
import zipfile
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Literal

import httpx2
import numpy as np
import openslide
import shapely
import tifffile
from numpy.typing import NDArray
from PIL import Image
from pydantic import BaseModel, ConfigDict
from shapely import STRtree, box
from shapely.geometry import shape as shape_of
from shapely.geometry.base import BaseGeometry
from sqlalchemy import select
from wsidicom import WsiDicom

from parfocal_api.patch_exports import (
    PATCH_KIND,
    PATCH_LEASE_SECONDS,
    PATCH_STEP,
    patch_export_key,
)
from parfocal_api.review_order_job import still_mine
from parfocal_api.tables import review_tasks, slides
from parfocal_api.training_exports import (
    ManifestClass,
    ManifestTask,
    NothingSignedOffError,
    dataset,
)
from parfocal_common.jobs import JobStoppedError, Step, StepFailedError, StepRun, Workflow
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest.identify import Format, Refusal, identify
from parfocal_ingest.pyramid import Level, Pyramid, Reader, main_series, read_pyramid, unpack
from parfocal_ingest.thumbnail import WHITE, background_of, flattened
from parfocal_ingest.workflow import READER_ERRORS, Resources, resources_from_environment

FORMAT = "parfocal-patch-dataset"
FORMAT_VERSION = 1
MANIFEST = "manifest.json"
INDEX = "index.csv"
BACKGROUND = 0
DRAWN_KINDS = ("region", "cell")
INDEX_COLUMNS = (
    "tile",
    "mask",
    "slide_id",
    "level",
    "downsample",
    "x",
    "y",
    "width",
    "height",
    "classes",
)

type SkipReason = Literal["level-missing", "no-file", "unreadable"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MaskRule(Strict):
    background: Literal[0]
    label: Literal["class-key"]
    pixel: Literal["centre-inside"]
    kinds: list[str]
    order: Literal["regions-then-cells-largest-first"]
    bits: Literal[8]


class PatchSlide(Strict):
    slide_id: uuid.UUID
    geojson: str
    level: int
    downsample: int
    width: int
    height: int
    tiles: int
    unclassed_left_out: int


class PatchSkipped(Strict):
    slide_id: uuid.UUID
    reason: SkipReason


class PatchManifest(Strict):
    format: Literal["parfocal-patch-dataset"]
    version: Literal[1]
    created_at: datetime
    task: ManifestTask
    coordinates: Literal["level-0-pixels"]
    level: int
    tile_size: int
    mask: MaskRule
    classes: list[ManifestClass]
    slides: list[PatchSlide]
    skipped: list[PatchSkipped]
    tiles: int


MASK_RULE = MaskRule(
    background=BACKGROUND,
    label="class-key",
    pixel="centre-inside",
    kinds=list(DRAWN_KINDS),
    order="regions-then-cells-largest-first",
    bits=8,
)


@dataclass(frozen=True)
class Labelled:
    key: int
    geometry: BaseGeometry


@dataclass(frozen=True)
class Tile:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class SlideSource:
    slide_id: uuid.UUID
    path: Path
    found: Format
    pyramid: Pyramid
    geojson: bytes


def labelled_of(features: Sequence[Mapping[str, Any]]) -> tuple[list[Labelled], int]:
    ranked: list[tuple[int, float, Labelled]] = []
    unclassed = 0
    for feature in features:
        parfocal = feature["properties"]["parfocal"]
        if parfocal["kind"] not in DRAWN_KINDS:
            continue
        if parfocal["class_key"] is None:
            unclassed += 1
            continue
        geometry = shape_of(feature["geometry"])
        if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        shapely.prepare(geometry)
        ranked.append(
            (
                DRAWN_KINDS.index(parfocal["kind"]),
                -geometry.area,
                Labelled(int(parfocal["class_key"]), geometry),
            )
        )
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in ranked], unclassed


def tiles_of(level: Level, size: int) -> list[Tile]:
    return [
        Tile(x, y, min(size, level.width - x), min(size, level.height - y))
        for y in range(0, level.height, size)
        for x in range(0, level.width, size)
    ]


def centres(start: int, count: int, low: float, high: float, scale: int) -> tuple[int, int]:
    first = max(0, math.ceil(low / scale - start - 0.5))
    last = min(count, math.floor(high / scale - start - 0.5) + 1)
    return first, last


class Painter:
    def __init__(self, shapes: Sequence[Labelled], downsample: int) -> None:
        self.shapes = list(shapes)
        self.downsample = downsample
        self.tree = STRtree([shape.geometry for shape in self.shapes])

    def mask(self, tile: Tile) -> NDArray[np.uint8]:
        scale = self.downsample
        found = np.zeros((tile.height, tile.width), dtype=np.uint8)
        left, top = tile.x * scale, tile.y * scale
        area = box(left, top, left + tile.width * scale, top + tile.height * scale)
        for index in sorted(int(hit) for hit in self.tree.query(area)):
            shape = self.shapes[index]
            low_x, low_y, high_x, high_y = shape.geometry.bounds
            left, right = centres(tile.x, tile.width, low_x, high_x, scale)
            top, bottom = centres(tile.y, tile.height, low_y, high_y, scale)
            if left >= right or top >= bottom:
                continue
            xs = (tile.x + np.arange(left, right) + 0.5) * scale
            ys = (tile.y + np.arange(top, bottom) + 0.5) * scale
            grid_x, grid_y = np.meshgrid(xs, ys)
            inside = shapely.contains_xy(shape.geometry, grid_x, grid_y)
            found[top:bottom, left:right][inside] = shape.key
        return found


@contextmanager
def openslide_reader(
    path: Path, found: Format, level: Level
) -> Iterator[Callable[[Tile], Image.Image]]:
    with openslide.OpenSlide(path) as slide:
        origin_x = origin_y = 0
        if found is Format.LEICA_SCN:
            origin_x = int(slide.properties.get("openslide.region[0].x", 0))
            origin_y = int(slide.properties.get("openslide.region[0].y", 0))
        index = min(
            range(slide.level_count),
            key=lambda k: abs(slide.level_downsamples[k] - level.downsample),
        )
        exact = slide.level_downsamples[index]
        background = background_of(slide)

        def read(tile: Tile) -> Image.Image:
            location = (origin_x + round(tile.x * exact), origin_y + round(tile.y * exact))
            region = slide.read_region(location, index, (tile.width, tile.height))
            return flattened(region, background)

        yield read


@contextmanager
def tifffile_reader(path: Path, level: Level) -> Iterator[Callable[[Tile], Image.Image]]:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        if series is None:
            raise ValueError("no slide series")
        pixels = series.levels[level.index].asarray()

    def read(tile: Tile) -> Image.Image:
        crop = pixels[tile.y : tile.y + tile.height, tile.x : tile.x + tile.width]
        return flattened(Image.fromarray(np.ascontiguousarray(crop)), WHITE)

    yield read


@contextmanager
def dicom_reader(path: Path, level: Level) -> Iterator[Callable[[Tile], Image.Image]]:
    with WsiDicom.open(path) as slide:
        exponent = int(math.log2(level.downsample))

        def read(tile: Tile) -> Image.Image:
            image = slide.read_region((tile.x, tile.y), exponent, (tile.width, tile.height))
            if not isinstance(image, Image.Image):
                raise TypeError("wsidicom returned an array")
            return flattened(image, WHITE)

        yield read


@contextmanager
def level_reader(source: SlideSource, level: Level) -> Iterator[Callable[[Tile], Image.Image]]:
    match source.pyramid.reader:
        case Reader.OPENSLIDE:
            with openslide_reader(source.path, source.found, level) as read:
                yield read
        case Reader.TIFFFILE:
            with tifffile_reader(source.path, level) as read:
                yield read
        case Reader.WSIDICOM:
            with dicom_reader(source.path, level) as read:
                yield read


def png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class PatchWriter:
    def __init__(self, target: BinaryIO, level: int, tile_size: int) -> None:
        self.archive = zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED)
        self.level = level
        self.tile_size = tile_size
        self.rows: list[list[str | int]] = []
        self.slides: list[PatchSlide] = []
        self.skipped: list[PatchSkipped] = []

    def skip(self, slide_id: uuid.UUID, reason: SkipReason) -> None:
        self.skipped.append(PatchSkipped(slide_id=slide_id, reason=reason))

    def add(self, source: SlideSource) -> None:
        if self.level >= len(source.pyramid.levels):
            self.skip(source.slide_id, "level-missing")
            return
        level = source.pyramid.levels[self.level]
        shapes, unclassed = labelled_of(json.loads(source.geojson)["features"])
        painter = Painter(shapes, level.downsample)
        geojson = f"slides/{source.slide_id}.geojson"
        self.archive.writestr(geojson, source.geojson)
        tiles = tiles_of(level, self.tile_size)
        with level_reader(source, level) as read:
            for tile in tiles:
                x, y = tile.x * level.downsample, tile.y * level.downsample
                name = f"{source.slide_id}/{x}_{y}.png"
                mask = painter.mask(tile)
                self.archive.writestr(f"tiles/{name}", png(read(tile)))
                self.archive.writestr(f"masks/{name}", png(Image.fromarray(mask)))
                present = [int(key) for key in np.unique(mask) if key != BACKGROUND]
                self.rows.append(
                    [
                        f"tiles/{name}",
                        f"masks/{name}",
                        str(source.slide_id),
                        self.level,
                        level.downsample,
                        x,
                        y,
                        tile.width,
                        tile.height,
                        ";".join(str(key) for key in present),
                    ]
                )
        self.slides.append(
            PatchSlide(
                slide_id=source.slide_id,
                geojson=geojson,
                level=self.level,
                downsample=level.downsample,
                width=level.width,
                height=level.height,
                tiles=len(tiles),
                unclassed_left_out=unclassed,
            )
        )

    def finish(self, task: ManifestTask, classes: list[ManifestClass]) -> PatchManifest:
        index = io.StringIO()
        writer = csv.writer(index, lineterminator="\n")
        writer.writerow(INDEX_COLUMNS)
        writer.writerows(self.rows)
        self.archive.writestr(INDEX, index.getvalue())
        manifest = PatchManifest(
            format=FORMAT,
            version=FORMAT_VERSION,
            created_at=datetime.now(UTC),
            task=task,
            coordinates="level-0-pixels",
            level=self.level,
            tile_size=self.tile_size,
            mask=MASK_RULE,
            classes=classes,
            slides=self.slides,
            skipped=self.skipped,
            tiles=len(self.rows),
        )
        self.archive.writestr(MANIFEST, manifest.model_dump_json(indent=2))
        self.archive.close()
        return manifest


def source_of(slide_id: uuid.UUID, path: Path, geojson: bytes) -> SlideSource | None:
    try:
        return opened_source(slide_id, path, geojson)
    except READER_ERRORS:
        return None


def opened_source(slide_id: uuid.UUID, path: Path, geojson: bytes) -> SlideSource | None:
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    if found.format is None:
        return None
    opened = path
    if found.variant == "zip":
        unpacked = unpack(path, path.parent / "unpacked", found.format)
        if isinstance(unpacked, Refusal):
            return None
        opened = unpacked
    pyramid = read_pyramid(opened, found)
    if isinstance(pyramid, Refusal):
        return None
    return SlideSource(slide_id, opened, found.format, pyramid, geojson)


async def export_patches(step: StepRun, resources: Resources) -> Mapping[str, Any]:
    task_id = uuid.UUID(step.input["task_id"])
    async with httpx2.AsyncClient(timeout=60) as http:
        store = resources.store_class(resources.storage, http)
        async with step.transaction() as connection:
            if not await still_mine(connection, step):
                raise JobStoppedError
            task = (
                await connection.execute(select(review_tasks).where(review_tasks.c.id == task_id))
            ).one_or_none()
            if task is None:
                raise StepFailedError("task-missing")
            try:
                made, files = await dataset(connection, task, ObjectResultStore(store))
            except NothingSignedOffError as error:
                raise StepFailedError(error.code) from error
            originals = {
                row.id: row.original_key
                for row in await connection.execute(
                    select(slides.c.id, slides.c.original_key).where(
                        slides.c.id.in_([entry.slide_id for entry in made.slides])
                    )
                )
            }
        folder = resources.work_dir / str(step.job_id)
        buffer = io.BytesIO()
        writer = PatchWriter(buffer, int(step.input["level"]), int(step.input["tile_size"]))
        try:
            for entry in made.slides:
                if await step.should_stop():
                    raise JobStoppedError
                key = originals.get(entry.slide_id)
                if key is None:
                    writer.skip(entry.slide_id, "no-file")
                    continue
                local = folder / str(entry.slide_id) / PurePosixPath(key).name
                local.parent.mkdir(parents=True, exist_ok=True)
                await store.download(key, local)
                source = await asyncio.to_thread(
                    source_of, entry.slide_id, local, files[entry.file.path]
                )
                if source is None:
                    writer.skip(entry.slide_id, "unreadable")
                else:
                    await asyncio.to_thread(writer.add, source)
                shutil.rmtree(local.parent, ignore_errors=True)
            manifest = writer.finish(made.task, made.classes)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        await store.put_object(
            patch_export_key(step.tenant_id, step.job_id), buffer.getvalue(), "application/zip"
        )
    return {
        "slides": len(manifest.slides),
        "skipped": len(manifest.skipped),
        "tiles": manifest.tiles,
    }


def patch_export_workflow(resources: Callable[[], Resources]) -> Workflow:
    async def export_step(step: StepRun) -> Mapping[str, Any]:
        return await export_patches(step, resources())

    return Workflow(
        kind=PATCH_KIND, steps=[Step(PATCH_STEP, export_step)], lease_seconds=PATCH_LEASE_SECONDS
    )


PATCH_EXPORT = patch_export_workflow(resources_from_environment)
