from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.tumor_probe import PROBE_PATCH, Features, Normalization, normalized

MIDNIGHT_REPO = "kaiko-ai/midnight"
MIDNIGHT_REVISION = "adc6b15679c981cce6f9b018bbad09d16eeeda9f"
MIDNIGHT_NORMALIZATION = Normalization((0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
MIDNIGHT_WIDTH = 1536
MIDNIGHT_TOKENS = 1 + (PROBE_PATCH // 14) ** 2
MIDNIGHT_FEATURES = 2 * MIDNIGHT_WIDTH

type TokenModel = Callable[[NDArray[np.float32]], NDArray[np.float32]]


def classification_embedding(tokens: NDArray[np.floating[Any]]) -> Features:
    if tokens.ndim != 3 or tokens.shape[1] != MIDNIGHT_TOKENS:
        raise ValueError(f"Midnight returns {MIDNIGHT_TOKENS} tokens per patch, got {tokens.shape}")
    return np.concatenate([tokens[:, 0], tokens[:, 1:].mean(axis=1)], axis=1).astype(np.float32)


class MidnightEmbedder:
    def __init__(self, model: TokenModel):
        self.model = model

    def embed(self, patches: NDArray[np.uint8]) -> Features:
        if patches.shape[1:] != (PROBE_PATCH, PROBE_PATCH, 3):
            raise ValueError(f"Midnight reads {PROBE_PATCH} px RGB patches, got {patches.shape}")
        return classification_embedding(self.model(normalized(patches, MIDNIGHT_NORMALIZATION)))


def torch_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def midnight_model(device: str | None = None) -> TokenModel:
    import torch
    from transformers import AutoModel

    chosen = device or torch_device()
    model = AutoModel.from_pretrained(MIDNIGHT_REPO, revision=MIDNIGHT_REVISION)
    model = model.to(chosen).eval()

    def run(batch: NDArray[np.float32]) -> NDArray[np.float32]:
        with torch.inference_mode():
            hidden = model(pixel_values=torch.from_numpy(batch).to(chosen)).last_hidden_state
            return hidden.float().cpu().numpy()

    return run


def midnight_embedder(device: str | None = None) -> MidnightEmbedder:
    return MidnightEmbedder(midnight_model(device))
