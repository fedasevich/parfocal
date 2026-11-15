import json
from pathlib import Path

import numpy as np

from parfocal_ml.sam_contract import QUANTISED_MIN_IOU
from parfocal_ml.sam_onnx.parity_fixture import ParityPatch, write


def test_write_lays_out_little_endian_tensors_and_a_manifest(tmp_path: Path) -> None:
    pixels = np.arange(6, dtype=np.float32).reshape(1, 3, 1, 2)
    embeddings = np.full((1, 2, 1, 1), 0.5, dtype=np.float32)
    maps = np.linspace(0, 1, 8, dtype=np.float32).reshape(1, 2, 2, 2)
    logits = [np.array([[-1.0, 2.0], [0.0, 3.0]], dtype=np.float32)]
    patch = ParityPatch(
        name="tnbc-01",
        height=512,
        width=512,
        pixels=pixels,
        clicks=[(256.0, 128.0)],
        embeddings=embeddings,
        masks=logits,
        maps=maps,
    )

    document = write(tmp_path, [patch], {"g.onnx": "abc"}, {"torch": "x"})

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest == document
    entry = manifest["patches"][0]
    assert entry["clicks"] == [[512.0, 256.0]]
    assert entry["mapsDims"] == [1, 2, 2, 2]
    assert manifest["thresholds"]["clickMeanIou"] == QUANTISED_MIN_IOU
    read = np.frombuffer((tmp_path / entry["pixels"]).read_bytes(), dtype="<f4")
    assert read.tolist() == pixels.ravel().tolist()
    masks = np.frombuffer((tmp_path / entry["masks"]).read_bytes(), dtype=np.uint8)
    assert masks.tolist() == [0, 1, 0, 1]
    assert (tmp_path / entry["maps"]).stat().st_size == maps.size * 4
