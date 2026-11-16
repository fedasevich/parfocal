import shutil

import numpy as np
import pytest
from numpy.typing import NDArray

from parfocal_ml.datasets import Sample, samples
from parfocal_ml.prompt_region import BASELINE_PQ, TOLERANCE, OnnxPrompt, run
from parfocal_ml.sam_contract import GRAPHS, IMAGE_SIZE, onnx_dir

SIZE = 128
CENTRES = [(30.0, 32.0), (90.0, 40.0), (60.0, 96.0)]
RADIUS = 9.0


class DiscModel:
    def __init__(self) -> None:
        self.encode_ms: list[float] = []
        self.decode_ms: list[float] = []
        ys, xs = np.mgrid[0:IMAGE_SIZE, 0:IMAGE_SIZE].astype(np.float32)
        self.points = (xs + 0.5, ys + 0.5)

    def encode(self, rgb: NDArray[np.uint8]) -> None:
        self.encode_ms.append(0.0)

    def best_mask(self, x: float, y: float) -> tuple[NDArray[np.float32], float]:
        self.decode_ms.append(0.0)
        scale = IMAGE_SIZE / SIZE
        xs, ys = self.points
        centre = min(CENTRES, key=lambda c: np.hypot(c[0] * scale - x, c[1] * scale - y))
        distance = np.hypot(xs - (centre[0] + 0.5) * scale, ys - (centre[1] + 0.5) * scale)
        logits = (RADIUS * scale - distance).astype("<f4")
        return np.clip(logits, -8, 8), 0.9


def stained_sample() -> Sample:
    ys, xs = np.mgrid[0:SIZE, 0:SIZE]
    labels = np.zeros((SIZE, SIZE), dtype=np.int32)
    for index, (cx, cy) in enumerate(CENTRES, start=1):
        labels[np.hypot(xs - cx, ys - cy) <= RADIUS] = index
    rgb = np.full((SIZE, SIZE, 3), 230, dtype=np.uint8)
    rgb[labels > 0] = 70
    return Sample(name="discs", rgb=rgb, labels=labels, ignore=None, group=None)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("quality", ["fast", "best"])
def test_the_typescript_prompt_pass_outlines_every_stained_disc(quality: str):
    model = DiscModel()
    result = run(model, [stained_sample()], "best" if quality == "best" else "fast")
    assert result.images == 1
    assert result.summary.f1 == 1.0
    assert result.summary.sq > 0.85
    assert result.decodes[0] == len(model.decode_ms)
    if quality == "best":
        assert result.decodes[0] >= len(CENTRES) * 5


@pytest.mark.weights
def test_prompt_fallback_meets_the_stain_seed_row_on_tnbc():
    graphs = [GRAPHS.encoder_uint8, GRAPHS.decoder]
    missing = [graph for graph in graphs if not (onnx_dir() / graph).exists()]
    if missing:
        pytest.skip(f"{', '.join(missing)} not in {onnx_dir()}")
    result = run(OnnxPrompt(GRAPHS.encoder_uint8, GRAPHS.decoder), samples("tnbc"))
    assert result.images == 50
    assert result.summary.pq >= BASELINE_PQ - TOLERANCE
