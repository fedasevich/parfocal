import hashlib
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.sam_contract import (
    IMAGE_SIZE,
    PIXEL_MEAN,
    PIXEL_STD,
    Checkpoint,
    CheckpointMismatchError,
    MissingCheckpointError,
    best_multimask,
    checkpoint_path,
    decoder_feeds,
    iou,
    pixel_values,
    resized_shape,
    scaled_point,
)


def fake_checkpoint(folder: Path, content: bytes = b"weights") -> Checkpoint:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "model.pt").write_bytes(content)
    return Checkpoint("model.pt", hashlib.sha256(content).hexdigest(), len(content))


def test_longest_side_scales_to_the_encoder_size() -> None:
    assert resized_shape(512, 512) == (1024, 1024)
    assert resized_shape(1500, 2250) == (683, 1024)


def test_pixels_are_normalised_and_padded_bottom_right() -> None:
    rgb = np.full((100, 200, 3), 200, dtype=np.uint8)
    pixels = pixel_values(rgb)
    assert pixels.shape == (1, 3, IMAGE_SIZE, IMAGE_SIZE)
    assert pixels.dtype == np.float32
    np.testing.assert_allclose(pixels[0, :, 0, 0], (200 - PIXEL_MEAN) / PIXEL_STD, rtol=1e-6)
    assert np.all(pixels[0, :, 512:, :] == 0)


def test_clicks_scale_with_the_patch() -> None:
    assert scaled_point(100, 50, 512, 512) == (200, 100)


def test_decoder_feeds_follow_the_samexporter_contract() -> None:
    embeddings = np.zeros((1, 256, 64, 64), dtype=np.float32)
    feeds = decoder_feeds(embeddings, (10, 20), 512, 512)
    assert feeds["point_coords"].tolist() == [[[20, 40], [0, 0]]]
    assert feeds["point_labels"].tolist() == [[1, -1]]
    assert feeds["mask_input"].shape == (1, 1, 256, 256)
    assert feeds["orig_im_size"].tolist() == [512, 512]


def test_decoder_feeds_refuse_a_non_square_patch() -> None:
    embeddings = np.zeros((1, 256, 64, 64), dtype=np.float32)
    with pytest.raises(ValueError, match="square"):
        decoder_feeds(embeddings, (10, 20), 512, 400)


def test_best_multimask_skips_the_single_mask_slot() -> None:
    masks = np.stack([np.full((2, 2), value, dtype=np.float32) for value in (5, -1, 1, -1)])[None]
    scores = np.array([[0.99, 0.1, 0.8, 0.3]], dtype=np.float32)
    assert best_multimask(masks, scores).all()


def test_iou_counts_overlap_over_union() -> None:
    a = np.array([True, True, False, False])
    b = np.array([True, False, True, False])
    assert iou(a, b) == pytest.approx(1 / 3)
    assert iou(np.zeros(3, dtype=bool), np.zeros(3, dtype=bool)) == 1.0


def test_checkpoint_links_from_a_local_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    checkpoint = fake_checkpoint(tmp_path / "poc")
    monkeypatch.setenv("PARFOCAL_MODELS_LOCAL", str(tmp_path / "poc"))
    found = checkpoint_path(checkpoint, tmp_path / "cache")
    assert found.is_symlink()
    assert (tmp_path / "cache" / "model.pt.sha256").read_text().strip() == checkpoint.sha256


def test_checkpoint_refuses_a_wrong_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint = fake_checkpoint(tmp_path / "poc")
    fake_checkpoint(tmp_path / "cache", b"tampered")
    monkeypatch.delenv("PARFOCAL_MODELS_LOCAL", raising=False)
    with pytest.raises(CheckpointMismatchError):
        checkpoint_path(checkpoint, tmp_path / "cache")


def test_checkpoint_names_the_way_to_fix_a_missing_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("PARFOCAL_MODELS_LOCAL", raising=False)
    with pytest.raises(MissingCheckpointError, match="PARFOCAL_MODELS_LOCAL"):
        checkpoint_path(Checkpoint("absent.pt", "0" * 64, 1), tmp_path)
