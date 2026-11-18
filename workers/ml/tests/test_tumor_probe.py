from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.tumor_froc import BUNDLE_SPACING_UM
from parfocal_ml.tumor_map import CELL, SCORES_PER_TILE, TILE_CELLS, TILE_SIDE, map_slide
from parfocal_ml.tumor_probe import (
    PROBE_PATCH,
    LinearProbe,
    Normalization,
    ProbeScorer,
    context_margin,
    embed_centres,
    fit_probe,
    normalized,
    probe_reader,
    read_side,
    tile_patch_count,
    training_patches,
)


class RedEmbedder:
    def __init__(self):
        self.batches: list[tuple[int, ...]] = []

    def embed(self, patches):
        self.batches.append(patches.shape)
        red = patches[..., 0].astype(np.float32).mean(axis=(1, 2)) / 255.0
        return np.stack([red, np.ones_like(red)], axis=1)


class PaintedReader:
    def __init__(self, width, height, red_from_x):
        self.width = width
        self.height = height
        self.red_from_x = red_from_x
        self.reads: list[tuple[int, int, int, int]] = []

    def read(self, x, y, width, height):
        self.reads.append((x, y, width, height))
        columns = np.arange(x, x + width)
        rgb = np.full((height, width, 3), 40, np.uint8)
        rgb[:, columns >= self.red_from_x, 0] = 255
        rgb[:, columns >= self.red_from_x, 1:] = 20
        return rgb


def red_probe():
    return LinearProbe(np.array([40.0, 0.0]), -20.0, np.zeros(2), np.ones(2))


def test_read_side_covers_224_pixels_at_half_a_micron():
    assert read_side(0.5) == PROBE_PATCH
    assert read_side(BUNDLE_SPACING_UM) == 461


def test_training_patches_take_the_centre_label():
    lines = [
        "tumor_024, 25417, 127565, 0, 0, 0, 1, 1, 0, 1, 1, 1",
        "normal_123, 67340, 12864, 0, 0, 0, 0, 0, 0, 0, 0, 0",
        "",
    ]
    patches = training_patches(lines)
    assert [(p.slide, p.x, p.y, p.tumor) for p in patches] == [
        ("tumor_024", 25417, 127565, True),
        ("normal_123", 67340, 12864, False),
    ]


def test_normalized_is_channels_first_and_centred():
    patches = np.full((2, 4, 4, 3), 255, np.uint8)
    out = normalized(patches, Normalization((0.5, 0.5, 0.5), (0.25, 0.25, 0.25)))
    assert out.shape == (2, 3, 4, 4)
    assert out.dtype == np.float32
    assert np.allclose(out, 2.0)


def test_fit_probe_separates_tumor_from_normal():
    generator = np.random.default_rng(7)
    tumor = generator.normal(2.0, 1.0, (200, 8))
    normal = generator.normal(-2.0, 1.0, (200, 8))
    features = np.concatenate([tumor, normal]).astype(np.float32)
    labels = np.concatenate([np.ones(200, bool), np.zeros(200, bool)])
    probe = fit_probe(features, labels)
    predicted = probe.probability(features) > 0.5
    assert (predicted == labels).mean() > 0.97
    assert probe.probability(np.full((1, 8), 3.0, np.float32))[0] > 0.99


def test_fit_probe_ignores_constant_features():
    features = np.array([[0.0, 5.0], [1.0, 5.0], [0.1, 5.0], [0.9, 5.0]], np.float32)
    labels = np.array([False, True, False, True])
    probe = fit_probe(features, labels)
    assert np.all(np.isfinite(probe.weights))
    assert (probe.probability(features) > 0.5).tolist() == labels.tolist()


def test_fit_probe_refuses_one_class_or_mismatched_rows():
    features = np.zeros((3, 2), np.float32)
    with pytest.raises(ValueError, match="tumor and normal"):
        fit_probe(features, np.ones(3, bool))
    with pytest.raises(ValueError, match="feature rows"):
        fit_probe(features, np.ones(2, bool))


def test_probe_round_trips_through_a_file(tmp_path: Path):
    probe = red_probe()
    path = tmp_path / "probe.npz"
    probe.save(path)
    loaded = LinearProbe.load(path)
    features = np.array([[0.2, 1.0], [0.9, 1.0]], np.float32)
    assert np.array_equal(loaded.probability(features), probe.probability(features))


def test_embed_centres_reads_scaled_patches_in_batches():
    reader = PaintedReader(10_000, 10_000, red_from_x=5_000)
    embedder = RedEmbedder()
    centres = [(1_000, 1_000), (9_000, 1_000), (2_000, 2_000)]
    features = embed_centres(reader, embedder, centres, read_side(BUNDLE_SPACING_UM), batch=2)
    assert embedder.batches == [(2, PROBE_PATCH, PROBE_PATCH, 3), (1, PROBE_PATCH, PROBE_PATCH, 3)]
    assert reader.reads[0] == (1_000 - 230, 1_000 - 230, 461, 461)
    assert features[1, 0] > 0.99 > features[0, 0]


def test_context_margin_fits_every_patch_inside_the_widened_tile():
    side = read_side(BUNDLE_SPACING_UM)
    for block in (1, 2, 4):
        extra = context_margin(side, block)
        scorer = ProbeScorer(RedEmbedder(), red_probe(), BUNDLE_SPACING_UM, block=block)
        assert scorer.extra == extra
        crops = scorer.crops(np.zeros((TILE_SIDE + 2 * extra,) * 2 + (3,), np.uint8))
        assert len(crops) == tile_patch_count(block)
        assert {crop.shape for crop in crops} == {(side, side, 3)}


def test_scorer_refuses_a_tile_without_context():
    scorer = ProbeScorer(RedEmbedder(), red_probe(), BUNDLE_SPACING_UM)
    with pytest.raises(ValueError, match="px tiles"):
        scorer.score(np.zeros((TILE_SIDE, TILE_SIDE, 3), np.uint8))
    with pytest.raises(ValueError, match="does not divide"):
        ProbeScorer(RedEmbedder(), red_probe(), BUNDLE_SPACING_UM, block=3)


def test_scorer_returns_the_tile_score_grid_in_batches():
    embedder = RedEmbedder()
    scorer = ProbeScorer(embedder, red_probe(), BUNDLE_SPACING_UM, batch=100)
    side = TILE_SIDE + 2 * scorer.extra
    rgb = np.full((side, side, 3), 40, np.uint8)
    rgb[:, side // 2 :, 0] = 255
    rgb[:, side // 2 :, 1:] = 20
    scores = scorer.score(rgb)
    assert scores.shape == (SCORES_PER_TILE, SCORES_PER_TILE)
    assert [shape[0] for shape in embedder.batches] == [100, 100, 56]
    assert scores[:, :8].max() < 0.01
    assert scores[:, -8:].min() > 0.99


def test_map_slide_runs_the_probe_through_a_widened_reader():
    cells = TILE_CELLS + 4
    red_from_x = (cells // 2) * CELL
    reader = PaintedReader(cells * CELL, cells * CELL, red_from_x)
    scorer = ProbeScorer(RedEmbedder(), red_probe(), BUNDLE_SPACING_UM, batch=64)
    tissue = np.ones((cells, cells), bool)
    mapped = map_slide(probe_reader(reader, scorer), scorer, tissue)
    assert mapped.probability.shape == (cells, cells)
    assert reader.reads[0][2] == TILE_SIDE + 2 * scorer.extra
    assert mapped.probability[:, :4].max() < 0.01
    assert mapped.probability[:, cells // 2 + 4 : TILE_CELLS].min() > 0.99
