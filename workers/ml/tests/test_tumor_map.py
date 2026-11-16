import asyncio
import json

import numpy as np
import pytest

from parfocal_common.result_imports import HEATMAP_FACTS, HEATMAP_GRID
from parfocal_ml.tumor_map import (
    CELL,
    MARGIN,
    SCORES_PER_TILE,
    STRIDE,
    TILE_CELLS,
    WINDOW,
    CellBox,
    decoded,
    halve,
    map_slide,
    otsu,
    pooled,
    pyramid,
    store_tumor_map,
    stored_values,
    tissue_cells,
    unpacked,
)

PINK = (230, 120, 200)
WHITE = (255, 255, 255)


class ArraySlide:
    def __init__(self, red: np.ndarray) -> None:
        self.rgb = np.full((*red.shape, 3), 255, np.uint8)
        self.rgb[..., 0] = red
        self.reads: list[tuple[int, int, int, int]] = []

    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        self.reads.append((x, y, width, height))
        out = np.full((height, width, 3), 255, np.uint8)
        top, left = max(0, y), max(0, x)
        bottom = min(self.rgb.shape[0], y + height)
        right = min(self.rgb.shape[1], x + width)
        if bottom > top and right > left:
            out[top - y : bottom - y, left - x : right - x] = self.rgb[top:bottom, left:right]
        return out


class CentreScorer:
    def score(self, rgb: np.ndarray) -> np.ndarray:
        steps = (rgb.shape[0] - WINDOW) // STRIDE + 1
        red = rgb[..., 0].astype(np.float32) / 255
        out = np.zeros((steps, steps), np.float32)
        for row in range(steps):
            for column in range(steps):
                top, left = row * STRIDE + MARGIN, column * STRIDE + MARGIN
                out[row, column] = red[top : top + STRIDE, left : left + STRIDE].mean()
        return out


def block_means(red: np.ndarray) -> np.ndarray:
    rows, columns = -(-red.shape[0] // CELL), -(-red.shape[1] // CELL)
    padded = np.full((rows * CELL, columns * CELL), 255, np.float32)
    padded[: red.shape[0], : red.shape[1]] = red
    return padded.reshape(rows, CELL, columns, CELL).mean(axis=(1, 3)) / 255


def test_the_map_lines_each_cell_up_with_its_own_pixels():
    rng = np.random.default_rng(1)
    red = rng.integers(0, 256, (CELL * 40, CELL * 37)).astype(np.uint8)
    tissue = np.ones((40, 37), bool)
    tumor_map = map_slide(ArraySlide(red), CentreScorer(), tissue)
    assert tumor_map.probability.shape == (40, 37)
    assert tumor_map.tiles == 4
    np.testing.assert_allclose(tumor_map.probability, block_means(red), atol=1e-5)


def test_cells_off_tissue_stay_zero_and_empty_tiles_are_never_read():
    red = np.full((CELL * 64, CELL * 64), 200, np.uint8)
    tissue = np.zeros((64, 64), bool)
    tissue[3:5, 40:44] = True
    slide = ArraySlide(red)
    tumor_map = map_slide(slide, CentreScorer(), tissue)
    assert slide.reads == [(TILE_CELLS * CELL - MARGIN, -MARGIN, 2240, 2240)]
    assert tumor_map.probability[~tissue].max() == 0
    assert tumor_map.probability[tissue].min() == pytest.approx(200 / 255)


def test_a_box_limits_the_map_to_the_tiles_under_it():
    red = np.full((CELL * 64, CELL * 64), 200, np.uint8)
    tumor_map = map_slide(
        ArraySlide(red), CentreScorer(), np.ones((64, 64), bool), box=CellBox(0, 32, 10, 64)
    )
    assert tumor_map.tiles == 1
    assert tumor_map.probability[:32].max() == 0
    assert tumor_map.probability[32:, :32].min() > 0


def test_a_stopped_map_keeps_what_it_scored():
    red = np.full((CELL * 64, CELL * 64), 200, np.uint8)
    calls = []
    tumor_map = map_slide(
        ArraySlide(red),
        CentreScorer(),
        np.ones((64, 64), bool),
        should_stop=lambda: len(calls) >= 2,
        on_tile=lambda done, total: calls.append((done, total)),
    )
    assert calls == [(1, 4), (2, 4)]
    assert (tumor_map.tiles, tumor_map.scored) == (4, 2)


def test_a_scorer_with_the_wrong_grid_is_refused():
    with pytest.raises(ValueError, match="scores 64 by 64"):
        pooled(np.zeros((SCORES_PER_TILE - 1, SCORES_PER_TILE)), 4, 4)


def test_tissue_is_the_saturated_part_of_the_thumbnail():
    thumbnail = np.full((60, 80, 3), WHITE, np.uint8)
    thumbnail[10:30, 20:60] = PINK
    tissue = tissue_cells(thumbnail, 64.0, 80 * 64, 60 * 64)
    assert tissue.shape == (60, 80)
    assert tissue[10:30, 20:60].all()
    assert tissue.sum() == 20 * 40


def test_otsu_splits_two_groups_and_never_drops_below_the_floor():
    values = np.concatenate([np.full(500, 5.0), np.full(500, 150.0)])
    assert 5 < otsu(values) <= 150
    assert otsu(np.full(100, 3.0)) == 20.0


def test_stored_values_round_trip_within_half_a_step():
    probability = np.linspace(0, 1, 101, dtype=np.float32).reshape(1, 101)
    values = stored_values(probability, np.ones((1, 101), bool))
    assert np.abs(decoded(values) - probability).max() <= 0.5 / 255 + 1e-6


def test_the_pyramid_keeps_a_lone_hot_cell_visible_at_every_level():
    values = np.zeros((1000, 600), np.uint8)
    values[777, 333] = 250
    levels = pyramid(values)
    assert [level.shape for level in levels] == [(1000, 600), (500, 300), (250, 150)]
    assert all(level.max() == 250 for level in levels)
    assert halve(np.array([[1, 2, 3]], np.uint8)).tolist() == [[2, 3]]


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


def test_the_stored_map_is_a_heatmap_grid_with_its_pyramid():
    red = np.full((CELL * 600, CELL * 40), 100, np.uint8)
    tissue = np.zeros((600, 40), bool)
    tissue[:, :20] = True
    tumor_map = map_slide(ArraySlide(red), CentreScorer(), tissue)
    store = MemoryStore()
    keys = asyncio.run(store_tumor_map(store, tumor_map, "t/1/s/2/results/3/", 0.25, 10))
    facts = json.loads(store.objects[f"t/1/s/2/results/3/{HEATMAP_FACTS}"])
    assert facts["object_key"] == f"t/1/s/2/results/3/{HEATMAP_GRID}"
    assert (facts["width"], facts["height"], facts["level"]) == (40, 600, 6)
    assert facts["downsample"] == 64.0
    assert facts["mpp"] == 16.0
    assert facts["tissue_share"] == 1.0
    assert [step["downsample"] for step in facts["pyramid"]] == [128.0, 256.0]
    base = unpacked(store.objects[facts["object_key"]], 40, 600)
    assert np.array_equal(base, stored_values(tumor_map.probability, tissue))
    top = facts["pyramid"][-1]
    assert unpacked(store.objects[top["object_key"]], top["width"], top["height"]).shape == (
        150,
        10,
    )
    assert len(keys) == 4
