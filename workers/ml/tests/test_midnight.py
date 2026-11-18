import numpy as np
import pytest

from parfocal_ml.midnight import (
    MIDNIGHT_FEATURES,
    MIDNIGHT_TOKENS,
    MIDNIGHT_WIDTH,
    MidnightEmbedder,
    classification_embedding,
)
from parfocal_ml.tumor_froc import BUNDLE_SPACING_UM
from parfocal_ml.tumor_map import TILE_SIDE
from parfocal_ml.tumor_probe import PROBE_PATCH, LinearProbe, ProbeScorer


class TokenRecorder:
    def __init__(self):
        self.inputs: list[np.ndarray] = []

    def __call__(self, batch):
        self.inputs.append(batch)
        count = batch.shape[0]
        tokens = np.zeros((count, MIDNIGHT_TOKENS, MIDNIGHT_WIDTH), np.float32)
        tokens[:, 0] = batch[:, 0].mean(axis=(1, 2))[:, None]
        tokens[:, 1:] = 2.0
        return tokens


def test_patch_grid_gives_257_tokens_and_3072_features():
    assert MIDNIGHT_TOKENS == 257
    assert MIDNIGHT_FEATURES == 3072


def test_classification_embedding_joins_cls_and_mean_patch_tokens():
    tokens = np.zeros((2, MIDNIGHT_TOKENS, MIDNIGHT_WIDTH), np.float32)
    tokens[:, 0] = 7.0
    tokens[:, 1:129] = 1.0
    tokens[:, 129:] = 3.0
    features = classification_embedding(tokens)
    assert features.shape == (2, MIDNIGHT_FEATURES)
    assert features.dtype == np.float32
    assert np.allclose(features[:, :MIDNIGHT_WIDTH], 7.0)
    assert np.allclose(features[:, MIDNIGHT_WIDTH:], 2.0)


def test_classification_embedding_refuses_another_token_count():
    with pytest.raises(ValueError, match="257 tokens"):
        classification_embedding(np.zeros((1, 1370, MIDNIGHT_WIDTH), np.float32))


def test_embedder_feeds_channels_first_patches_scaled_to_plus_minus_one():
    model = TokenRecorder()
    patches = np.zeros((3, PROBE_PATCH, PROBE_PATCH, 3), np.uint8)
    patches[1] = 255
    features = MidnightEmbedder(model).embed(patches)
    (batch,) = model.inputs
    assert batch.shape == (3, 3, PROBE_PATCH, PROBE_PATCH)
    assert batch.dtype == np.float32
    assert batch.min() == -1.0
    assert batch.max() == 1.0
    assert features.shape == (3, MIDNIGHT_FEATURES)
    assert features[:, 0].tolist() == [-1.0, 1.0, -1.0]


def test_embedder_refuses_patches_of_another_size():
    with pytest.raises(ValueError, match="224 px"):
        MidnightEmbedder(TokenRecorder()).embed(np.zeros((1, 256, 256, 3), np.uint8))


def test_scorer_runs_on_midnight_features():
    weights = np.zeros(MIDNIGHT_FEATURES)
    weights[0] = 40.0
    probe = LinearProbe(weights, 0.0, np.zeros(MIDNIGHT_FEATURES), np.ones(MIDNIGHT_FEATURES))
    scorer = ProbeScorer(MidnightEmbedder(TokenRecorder()), probe, BUNDLE_SPACING_UM, block=4)
    side = 2 * scorer.extra
    rgb = np.full((TILE_SIDE + side, TILE_SIDE + side, 3), 255, np.uint8)
    scores = scorer.score(rgb)
    assert scores.min() > 0.99
