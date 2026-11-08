import shutil
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.ais_region import (
    BASELINE_PQ,
    TOLERANCE,
    Maps,
    OnnxAis,
    run,
    typescript_rings,
    write_maps,
)
from parfocal_ml.datasets import samples
from parfocal_ml.sam_contract import GRAPHS, onnx_dir
from parfocal_ml.scoring import score_image, summarise


def disc_maps(size: int, centre: tuple[float, float], radius: float) -> np.ndarray:
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    distance = np.hypot(xs - centre[0], ys - centre[1]) / radius
    inside = distance <= 1
    maps = np.ones((3, size, size), dtype=np.float32)
    maps[0] = inside
    maps[1] = np.where(inside, distance, 1)
    maps[2] = np.where(inside, distance * 0.8, 1)
    return maps


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_typescript_rings_score_a_disc_as_the_same_nucleus(tmp_path: Path):
    write_maps(tmp_path, [Maps("disc", disc_maps(64, (30.0, 28.0), 10.0))])
    rings = typescript_rings(tmp_path)
    ring_list, _ = rings["disc"]
    assert len(ring_list) == 1
    ys, xs = np.mgrid[0:64, 0:64]
    labels = (np.hypot(xs - 30.0, ys - 28.0) <= 10.0).astype(np.int32)
    summary = summarise([score_image(labels, ring_list)])
    assert summary.f1 == 1.0
    assert summary.sq > 0.9


@pytest.mark.weights
def test_auto_region_meets_the_browser_ais_baseline_on_tnbc():
    graphs = [GRAPHS.encoder_uint8, GRAPHS.ais_decoder_int8_weights]
    missing = [graph for graph in graphs if not (onnx_dir() / graph).exists()]
    if missing:
        pytest.skip(f"{', '.join(missing)} not in {onnx_dir()}")
    result = run(OnnxAis(GRAPHS.encoder_uint8, GRAPHS.ais_decoder_int8_weights), samples("tnbc"))
    assert result.images == 50
    assert result.summary.pq >= BASELINE_PQ - TOLERANCE
