import json
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.datasets import Sample
from parfocal_ml.nucleus_lineup import (
    POC_FIXTURES,
    fixture_samples,
    image_mean,
    run,
    stored_detector,
)
from parfocal_ml.sam_contract import AIS, AIS_VIT_L, SAM, SAM_VIT_L
from parfocal_ml.scoring import score_image

HAVE_FIXTURES = (POC_FIXTURES / "nuinsseg" / "results" / "hovernet-batch.jsonl").exists()


def square(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0, y0, x1, y0, x1, y1, x0, y1]


def two_nuclei() -> np.ndarray:
    labels = np.zeros((20, 20), np.int32)
    labels[2:6, 2:6] = 1
    labels[10:14, 10:14] = 2
    return labels


def write_fixture(root: Path, names: list[str]) -> None:
    folder = root / "toy"
    (folder / "results").mkdir(parents=True)
    images = [{"name": name, "width": 20, "height": 20} for name in names]
    (folder / "index.json").write_text(json.dumps({"images": images}))
    for name in names:
        two_nuclei().astype("<u2").tofile(folder / f"{name}.labels")
        np.zeros((20, 20, 4), np.uint8).tofile(folder / f"{name}.rgba")
    (folder / f"{names[0]}.ignore").write_bytes(np.ones((20, 20), np.uint8).tobytes())


def test_fixture_samples_keep_every_nth_image_with_labels_and_ignore(tmp_path: Path) -> None:
    write_fixture(tmp_path, [f"organ__img{index}" for index in range(5)])
    kept = fixture_samples("toy", tmp_path, step=2)
    assert [sample.name for sample in kept] == ["organ__img0", "organ__img2", "organ__img4"]
    assert kept[0].ignore is not None
    assert kept[0].ignore.all()
    assert kept[1].ignore is None
    assert kept[0].group == "organ"
    assert kept[0].rgb.shape == (20, 20, 3)
    assert int(kept[0].labels.max()) == 2


def test_a_perfect_detector_scores_one_and_a_blind_one_scores_zero() -> None:
    sample = Sample(
        name="a", rgb=np.zeros((20, 20, 3), np.uint8), labels=two_nuclei(), ignore=None, group=None
    )
    perfect = run(lambda _: [square(1.5, 1.5, 5.5, 5.5), square(9.5, 9.5, 13.5, 13.5)], [sample])
    assert perfect.summary.pq == pytest.approx(1.0)
    assert perfect.mean_pq == pytest.approx(1.0)
    blind = run(lambda _: [], [sample])
    assert blind.summary.pq == 0
    assert blind.summary.recall == 0
    assert len(blind.infer_ms) == 1


def test_the_image_mean_skips_images_with_neither_nuclei_nor_predictions() -> None:
    empty = score_image(np.zeros((20, 20), np.int32), [])
    full = score_image(two_nuclei(), [square(1.5, 1.5, 5.5, 5.5), square(9.5, 9.5, 13.5, 13.5)])
    assert image_mean([empty, full], "pq") == pytest.approx(1.0)


def test_the_vit_l_checkpoints_are_their_own_files_and_not_the_vit_b_ones() -> None:
    assert SAM_VIT_L.file != SAM.file
    assert SAM_VIT_L.sha256 != SAM.sha256
    assert AIS_VIT_L.file != AIS.file
    assert AIS_VIT_L.sha256 != AIS.sha256
    assert AIS_VIT_L.size == AIS.size


@pytest.mark.skipif(not HAVE_FIXTURES, reason="the POC's held-out fixtures are not on this machine")
@pytest.mark.parametrize(
    ("dataset", "images", "nuclei", "pq"),
    [("tnbc", 50, 4056, 0.8282), ("nuinsseg", 67, 2456, 0.5240), ("cryonuseg", 30, 8899, 0.4833)],
)
def test_the_stored_vit_b_predictions_give_the_poc_held_out_numbers(
    dataset: str, images: int, nuclei: int, pq: float
) -> None:
    kept = fixture_samples(dataset)
    result = run(stored_detector(dataset, "pathosam-vit-b-poc", kept), kept)
    assert (result.images, result.summary.nuclei) == (images, nuclei)
    assert result.summary.pq == pytest.approx(pq, abs=5e-5)
