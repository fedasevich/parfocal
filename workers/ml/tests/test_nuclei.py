import asyncio
import math
import uuid

import numpy as np
from nuclei_support import ArrayReader, StainMaps, disks
from skimage.draw import polygon as fill_polygon

from parfocal_common.cell_chunks import UNCLASSIFIED
from parfocal_common.chunk_store import cells_in, chunk_of
from parfocal_ml.nuclei import (
    WINDOW_HALO_PX,
    WINDOW_PX,
    AisOptions,
    PathoSamDetector,
    Quality,
    detect_outlines,
    encoder_input,
    half_pixel_resize,
    stitched_maps,
    traced,
)
from parfocal_ml.sam_contract import IMAGE_SIZE
from parfocal_ml.whole_slide import Window, plan_tiles, run_prefix, run_tiles, tile_key

RADIUS = 9.0


class Pointwise:
    def __init__(self) -> None:
        self.shapes: list[tuple[int, int]] = []

    def maps(self, rgb: np.ndarray) -> np.ndarray:
        self.shapes.append(rgb.shape[:2])
        return (rgb.transpose(2, 0, 1) / 255).astype(np.float32)


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


class Progress:
    def __init__(self) -> None:
        self.marked: dict[int, int] = {}

    async def done(self) -> frozenset[int]:
        return frozenset(self.marked)

    async def total(self, count: int) -> None:
        return None

    async def mark(self, tile, objects: int) -> None:
        self.marked[tile.index] = objects

    async def should_stop(self) -> bool:
        return False


def grid_centres(width: int, height: int, step: int, offset: float) -> list[tuple[float, float]]:
    return [
        (x + offset, y + offset)
        for y in range(step, height - step, step)
        for x in range(step, width - step, step)
    ]


def test_qualities_follow_the_model_line_up():
    assert Quality.BEST.mpp == 0.25
    assert Quality.FAST.mpp == 0.33
    assert (WINDOW_PX, WINDOW_HALO_PX) == (512, 64)


def test_stitched_windows_match_one_pass_and_keep_the_halo():
    rgb = np.random.default_rng(3).integers(0, 255, (1300, 1100, 3), dtype=np.uint8)
    model = Pointwise()
    stitched = stitched_maps(rgb, model)
    np.testing.assert_allclose(stitched, rgb.transpose(2, 0, 1) / 255, atol=1e-6)
    assert len(model.shapes) == 3 * 3
    assert max(max(shape) for shape in model.shapes) == WINDOW_PX + 2 * WINDOW_HALO_PX


def test_a_small_patch_runs_in_one_window():
    model = Pointwise()
    stitched_maps(np.zeros((600, 640, 3), np.uint8), model)
    assert model.shapes == [(600, 640)]


def test_half_pixel_resize_matches_bilinear_without_corner_alignment():
    planes = np.array([[[0.0, 1.0]]], np.float32)
    np.testing.assert_allclose(half_pixel_resize(planes, 1, 4)[0, 0], [0, 0.25, 0.75, 1])


def test_encoder_input_resizes_the_longest_side_and_pads_with_zero():
    tensor, height, width = encoder_input(np.full((320, 640, 3), 200, np.uint8))
    assert tensor.shape == (1, 3, IMAGE_SIZE, IMAGE_SIZE)
    assert (height, width) == (512, IMAGE_SIZE)
    assert np.all(tensor[0, :, height:, :] == 0)
    assert np.all(tensor[0, :, :height, :] > 0)


def test_outlines_are_sub_pixel_and_cover_the_disk():
    centres = grid_centres(300, 300, 40, 0.3)
    rgb = disks(300, 300, centres, RADIUS)
    outlines = detect_outlines(rgb, StainMaps(RADIUS))
    assert len(outlines) == len(centres)
    truth = rgb[..., 0] < 128
    for outline in outlines:
        mask = np.zeros(truth.shape, bool)
        rows, columns = fill_polygon(outline.ring[:, 1], outline.ring[:, 0], mask.shape)
        mask[rows, columns] = True
        x, y = outline.centre
        nearest = min(centres, key=lambda centre: math.dist(centre, (x, y)))
        assert math.dist(nearest, (x, y)) < 0.5
        disk = truth & (
            np.hypot(*np.mgrid[0:300, 0:300][::-1] - np.array(nearest)[:, None, None]) < 2 * RADIUS
        )
        assert (mask & disk).sum() / disk.sum() >= 0.98
        assert not np.allclose(outline.ring, outline.ring.round())


def test_tracing_skips_specks_below_the_minimum_area():
    labels = np.zeros((40, 40), np.int32)
    labels[5:8, 5:8] = 1
    labels[20:30, 20:30] = 2
    found = traced(labels, (labels > 0).astype(np.float32), AisOptions())
    assert len(found) == 1
    assert found[0].area == 100


def test_detector_returns_outlines_in_slide_pixels():
    slide_mpp = 0.5
    centres = grid_centres(400, 300, 30, 0.0)
    slide = disks(300, 400, centres, RADIUS / 2)
    reader = ArrayReader(slide, slide_mpp)
    detector = PathoSamDetector(reader, StainMaps(RADIUS), Quality.BEST)
    cells = asyncio.run(detector.detect(Window(0, 0, 400, 300)))
    assert len(cells) == len(centres)
    found = sorted((round(np.mean(c.ring[1::2])), round(np.mean(c.ring[0::2]))) for c in cells)
    assert found == sorted((round(y), round(x)) for x, y in centres)
    assert {cell.class_index for cell in cells} == {UNCLASSIFIED}
    assert all(200 < cell.score <= 255 for cell in cells)


def test_fast_quality_reads_fewer_pixels():
    slide = disks(300, 400, [], RADIUS)
    model = StainMaps(RADIUS)
    detector = PathoSamDetector(ArrayReader(slide, 0.5), model, Quality.FAST)
    asyncio.run(detector.detect(Window(0, 0, 400, 300)))
    assert model.shapes == [(455, 606)]


def test_whole_slide_run_keeps_each_nucleus_once():
    slide_mpp = 0.25
    width, height = 1400, 1000
    centres = grid_centres(width, height, 47, 0.0)
    slide = disks(height, width, centres, RADIUS)
    detector = PathoSamDetector(ArrayReader(slide, slide_mpp), StainMaps(RADIUS))
    whole = Window(0, 0, width, height)
    plan = plan_tiles(whole, whole, 600, 40)
    store, progress = MemoryStore(), Progress()
    prefix = run_prefix(uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3))
    asyncio.run(run_tiles(plan, plan.tiles, detector, store, prefix, progress))
    found: list[tuple[float, float]] = []
    for tile in plan.tiles:
        header, arrays = chunk_of(store.objects[tile_key(prefix, tile.index)])
        for cell in cells_in(header, arrays):
            found.append((float(np.mean(cell.ring[0::2])), float(np.mean(cell.ring[1::2]))))
    assert len(found) == len(centres)
    for x, y in centres:
        assert min(math.dist((x, y), centre) for centre in found) < 0.5
