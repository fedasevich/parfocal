import itertools
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from parfocal_ml.datasets import Sample, samples
from parfocal_ml.instanseg import (
    dump_tiles,
    export_network,
    file_segmenter,
    full_size,
    model_dir,
    model_input,
    normalise,
    post_process_settings,
    rings_of,
    run,
    torch_segmenter,
)

TNBC_PQ_FLOOR = 0.70


def disc_labels(size: int, discs: list[tuple[int, int, int]]) -> np.ndarray:
    ys, xs = np.mgrid[0:size, 0:size]
    labels = np.zeros((size, size), np.int32)
    for label, (x, y, radius) in enumerate(discs, start=1):
        labels[np.hypot(xs - x, ys - y) <= radius] = label
    return labels


def test_normalise_stretches_each_channel_to_the_unit_range():
    rgb = np.zeros((32, 32, 3), np.uint8)
    rgb[..., 0] = np.arange(32, dtype=np.uint8)[None, :] * 4 + 20
    rgb[..., 1] = 100
    rgb[..., 2] = np.arange(32, dtype=np.uint8)[:, None]
    pixels = normalise(rgb)
    assert pixels.shape == (1, 3, 32, 32)
    assert pixels.dtype == np.float32
    assert pixels[0, 0].min() == pytest.approx(0, abs=0.01)
    assert pixels[0, 0].max() == pytest.approx(1, abs=0.01)
    assert np.all(pixels[0, 1] == 0)


def test_model_input_halves_a_quarter_micron_tile_to_the_model_scale():
    rgb = np.random.default_rng(1).integers(0, 255, (512, 512, 3), dtype=np.uint8)
    assert model_input(rgb, 0.25).shape == (1, 3, 256, 256)
    assert model_input(rgb, 0.5).shape == (1, 3, 512, 512)


def test_full_size_restores_labels_with_nearest_neighbour():
    small = disc_labels(64, [(20, 20, 8), (44, 40, 6)])
    large = full_size(small, (128, 128))
    assert large.shape == (128, 128)
    assert set(np.unique(large)) == {0, 1, 2}


def test_a_perfect_segmenter_scores_full_pq():
    labels = disc_labels(128, [(30, 30, 12), (90, 80, 14), (40, 100, 10)])
    rgb = np.full((128, 128, 3), 200, np.uint8)
    rgb[labels > 0] = 60
    sample = Sample(name="discs", rgb=rgb, labels=labels, ignore=None, group=None)
    result = run(lambda pixels: labels[::2, ::2].copy(), [sample], 0.25)
    assert result.images == 1
    assert result.input_side == [64]
    assert result.summary.recall == 1
    assert result.summary.precision == 1
    assert result.summary.pq > 0.85
    assert len(rings_of(labels)) == 3


def test_dumped_tiles_come_back_as_labels_in_order(tmp_path: Path):
    labels = disc_labels(128, [(30, 30, 12), (90, 80, 14)])
    rgb = np.full((128, 128, 3), 200, np.uint8)
    rgb[labels > 0] = 60
    tiles = [
        Sample(name=f"tile-{index}", rgb=rgb, labels=labels, ignore=None, group=None)
        for index in range(2)
    ]
    assert dump_tiles(tiles, tmp_path, 0.25) == 2
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["micronsPerPixel"] == 0.25
    first = manifest["tiles"][0]
    assert (first["height"], first["width"], first["modelHeight"], first["modelWidth"]) == (
        128,
        128,
        64,
        64,
    )
    assert (tmp_path / first["file"]).stat().st_size == 128 * 128 * 3
    for tile in manifest["tiles"]:
        labels[::2, ::2].astype("<i4").tofile(tmp_path / tile["labels"])
    result = run(file_segmenter(tmp_path), tiles, 0.25)
    assert result.images == 2
    assert result.summary.recall == 1
    with pytest.raises(ValueError, match="the model input is"):
        file_segmenter(tmp_path)(np.zeros((1, 3, 32, 32), np.float32))


@pytest.mark.weights
def test_the_post_processing_settings_hold_the_pixel_classifier():
    folder = model_dir()
    if not (folder / "instanseg.pt").exists():
        pytest.skip(f"instanseg.pt not in {folder}")
    settings: Any = post_process_settings(folder)
    shapes = [(len(layer["weights"]), len(layer["weights"][0])) for layer in settings["classifier"]]
    assert shapes == [(5, 4), (5, 5), (1, 5)]
    assert settings["maskThreshold"] == pytest.approx(0.53)
    assert settings["peakDistance"] == 5
    assert settings["windowSize"] == 32


@pytest.mark.weights
def test_the_torchscript_model_reproduces_its_shipped_test_output():
    folder = model_dir()
    if not (folder / "instanseg.pt").exists():
        pytest.skip(f"instanseg.pt not in {folder}")
    raw = np.load(folder / "test-input.npy")
    low = np.percentile(raw, 0.1, axis=(2, 3), keepdims=True)
    high = np.percentile(raw, 99.9, axis=(2, 3), keepdims=True)
    pixels = ((raw - low) / (high - low + 1e-6)).astype(np.float32)
    expected = np.load(folder / "test-output_instance_segmentation.npy")[0, 0]
    assert np.array_equal(torch_segmenter(folder)(pixels), expected.astype(np.int32))


@pytest.mark.weights
def test_the_exported_network_matches_torchscript(tmp_path: Path):
    import onnxruntime as ort
    import torch

    folder = model_dir()
    if not (folder / "instanseg.pt").exists():
        pytest.skip(f"instanseg.pt not in {folder}")
    target = tmp_path / "instanseg-fcn.onnx"
    export_network(folder, target)
    pixels = np.random.default_rng(2).random((1, 3, 256, 256), dtype=np.float32)
    model = torch.jit.load(str(folder / "instanseg.pt"), map_location="cpu").eval()
    with torch.no_grad():
        expected = model.fcn(torch.from_numpy(pixels)).numpy()
    session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
    got = np.asarray(session.run(None, {"pixels": pixels})[0])
    assert got.shape == (1, 5, 256, 256)
    assert float(np.abs(got - expected).max()) < 1e-3


@pytest.mark.weights
def test_instanseg_stays_above_its_floor_on_tnbc():
    folder = model_dir()
    if not (folder / "instanseg.pt").exists():
        pytest.skip(f"instanseg.pt not in {folder}")
    result = run(torch_segmenter(folder), itertools.islice(samples("tnbc"), 10), 0.25)
    assert result.summary.pq >= TNBC_PQ_FLOOR
