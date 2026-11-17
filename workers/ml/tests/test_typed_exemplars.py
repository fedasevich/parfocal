import numpy as np
import pytest

from parfocal_ml.datasets import Sample
from parfocal_ml.sam_contract import EMBED_DIM, EMBED_SIZE
from parfocal_ml.typed_exemplars import (
    SHOTS,
    UNMATCHED,
    Features,
    evaluate,
    exemplars_for,
    features_of,
    matched_kind,
    mosaic,
    pool_of,
    precision_at,
    rasterised,
)

SIDE = 512
CELL = SIDE // EMBED_SIZE


def tile(index: int) -> Sample:
    labels = np.zeros((256, 256), np.int32)
    labels[10:20, 10:20] = 1
    labels[40:60, 40:60] = 2
    rgb = np.full((256, 256, 3), index * 10, np.uint8)
    return Sample(f"t{index}", rgb, labels, None, "Breast", {1: "neoplastic", 2: "dead"})


def test_mosaic_places_tiles_and_renumbers_their_nuclei() -> None:
    joined = mosaic([tile(index) for index in range(4)])
    assert joined.rgb.shape == (512, 512, 3)
    assert joined.rgb[300, 300, 0] == 30
    assert joined.labels[15, 15] == 1
    assert joined.labels[15, 256 + 15] == 3
    assert joined.labels[256 + 50, 256 + 50] == 8
    assert joined.classes == {1: "neoplastic", 2: "dead", 3: "neoplastic", 4: "dead"} | {
        5: "neoplastic",
        6: "dead",
        7: "neoplastic",
        8: "dead",
    }


def test_mosaic_needs_four_tiles() -> None:
    with pytest.raises(ValueError, match="four"):
        mosaic([tile(0)])


def test_rasterised_fills_a_square_ring() -> None:
    (mask,) = rasterised([[10, 20, 30, 20, 30, 40, 10, 40]], 64)
    assert mask[30, 20]
    assert not mask[5, 5]
    assert rasterised([[200, 200, 210, 200, 210, 210]], 64) == []


def test_matched_kind_needs_half_iou() -> None:
    labels = np.zeros((64, 64), np.int32)
    labels[10:20, 10:20] = 4
    classes = {4: "inflammatory"}
    exact = labels == 4
    assert matched_kind(labels, classes, exact) == "inflammatory"
    loose = np.zeros_like(exact)
    loose[10:30, 10:20] = True
    assert matched_kind(labels, classes, loose) == "inflammatory"
    looser = np.zeros_like(exact)
    looser[10:40, 10:20] = True
    assert matched_kind(labels, classes, looser) == UNMATCHED
    background = np.zeros_like(exact)
    background[40:50, 40:50] = True
    assert matched_kind(labels, classes, background) == UNMATCHED


def test_features_pool_tokens_under_each_mask() -> None:
    embedding = np.zeros((1, EMBED_DIM, EMBED_SIZE, EMBED_SIZE), np.float32)
    embedding[0, 0] = 1
    embedding[0, 1, 5, 5] = 3
    mask = np.zeros((SIDE, SIDE), bool)
    mask[5 * CELL : 6 * CELL, 5 * CELL : 6 * CELL] = True
    rgb = np.zeros((SIDE, SIDE, 3), np.uint8)
    rgb[mask] = (200, 100, 50)
    features = features_of(embedding, rgb, [(mask, "dead"), (np.zeros_like(mask), "dead")], 7)
    assert len(features) == 1
    assert features.vectors.shape == (1, EMBED_DIM)
    assert features.vectors[0, 1] > features.vectors[0, 0]
    assert features.colours[0].tolist() == [200, 100, 50]
    assert features.mosaics.tolist() == [7]


def test_precision_at_k_is_nan_when_the_pool_is_short() -> None:
    hits = np.array([True, False, True, True])
    assert precision_at(hits, 2) == 0.5
    assert np.isnan(precision_at(hits, 10))


def synthetic(rng: np.random.Generator) -> Features:
    kinds = np.array(["neoplastic"] * 40 + ["inflammatory"] * 160)
    direction = {"neoplastic": np.eye(8)[0], "inflammatory": np.eye(8)[1]}
    vectors = np.stack([direction[kind] + rng.normal(scale=0.2, size=8) for kind in kinds])
    colours = rng.uniform(0, 255, size=(len(kinds), 3))
    mosaics = rng.integers(0, 10, size=len(kinds))
    return Features(vectors, colours, kinds.astype(np.str_), mosaics)


def test_exemplars_come_from_one_mosaic_of_the_kind() -> None:
    rng = np.random.default_rng(3)
    features = synthetic(rng)
    chosen = exemplars_for(features, "neoplastic", rng)
    assert chosen is not None
    assert len(chosen) == SHOTS
    assert len(set(features.mosaics[chosen].tolist())) == 1
    assert set(features.kinds[chosen].tolist()) == {"neoplastic"}
    assert exemplars_for(features, "dead", rng) is None


def test_pools_drop_exemplars_and_optionally_their_mosaic() -> None:
    features = synthetic(np.random.default_rng(4))
    chosen = np.flatnonzero(features.mosaics == features.mosaics[0])[:SHOTS]
    everything = pool_of(features, chosen, "all")
    others = pool_of(features, chosen, "other mosaics")
    assert len(everything) == len(features) - len(chosen)
    assert not set(chosen.tolist()) & set(everything.tolist())
    assert (features.mosaics[others] != features.mosaics[chosen[0]]).all()


def test_token_ranking_beats_random_on_separable_kinds() -> None:
    rng = np.random.default_rng(5)
    result = evaluate(synthetic(rng), "neoplastic", rng)
    assert result.draws > 0
    assert result.prevalence["all"] == pytest.approx(37 / 197, abs=1e-3)
    tokens = result.precision["all"]["tokens"]
    assert tokens[10] == 1.0
    assert tokens[50] > 0.7
    assert result.precision["all"]["random"][10] < 0.5
    assert np.isnan(evaluate(synthetic(rng), "dead", rng).prevalence["all"])
