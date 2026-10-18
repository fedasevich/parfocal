import json
import os
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.scoring import score_image, summarise

POC_FIXTURES = Path(
    os.environ.get(
        "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
    )
)
REPRODUCED = ("hovernet-batch", "pathosam-ais-batch", "vista2d-batch")


def square(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0, y0, x1, y0, x1, y1, x0, y1]


def two_nuclei() -> np.ndarray:
    labels = np.zeros((20, 20), np.int32)
    labels[2:6, 2:6] = 1
    labels[10:14, 10:14] = 2
    return labels


def test_a_ring_on_the_true_edge_scores_one() -> None:
    score = score_image(two_nuclei(), [square(1.5, 1.5, 5.5, 5.5), square(9.5, 9.5, 13.5, 13.5)])
    summary = summarise([score])
    assert (summary.nuclei, summary.predicted, summary.recall, summary.precision) == (2, 2, 1, 1)
    assert summary.pq == pytest.approx(1.0)
    assert summary.aji == pytest.approx(1.0)


def test_a_ring_through_pixel_centres_covers_less_than_the_nucleus() -> None:
    [nucleus] = score_image(two_nuclei()[:8, :8], [square(2, 2, 5, 5)]).nuclei
    assert nucleus.iou == pytest.approx(9 / 16)


def test_misses_and_extra_rings_count_against_f1_pq_and_aji() -> None:
    score = score_image(two_nuclei(), [square(1.5, 1.5, 5.5, 5.5), square(15.5, 15.5, 18.5, 18.5)])
    summary = summarise([score])
    assert (summary.recall, summary.precision) == (0.5, 0.5)
    assert summary.f1 == pytest.approx(1 / (1 + 0.5 + 0.5))
    assert summary.pq == pytest.approx(0.5)
    assert summary.aji == pytest.approx(16 / (16 + 16 + 9))


def test_vague_nuclei_and_rings_in_ignored_areas_are_left_out() -> None:
    ignore = np.zeros((20, 20), bool)
    ignore[9:15, 9:15] = True
    score = score_image(
        two_nuclei(), [square(1.5, 1.5, 5.5, 5.5), square(9.5, 9.5, 13.5, 13.5)], ignore
    )
    assert (len(score.nuclei), score.predicted) == (1, 1)


def test_scores_break_down_by_organ() -> None:
    perfect = score_image(
        two_nuclei(), [square(1.5, 1.5, 5.5, 5.5), square(9.5, 9.5, 13.5, 13.5)], group="bladder"
    )
    empty = score_image(two_nuclei(), [], group="liver")
    summary = summarise([perfect, empty])
    assert summary.recall == 0.5
    assert {name: group.recall for name, group in summary.groups.items()} == {
        "bladder": 1.0,
        "liver": 0.0,
    }


def load(dataset: str) -> dict[str, tuple[np.ndarray, np.ndarray | None]]:
    folder = POC_FIXTURES / dataset
    index = json.loads((folder / "index.json").read_text())
    images: dict[str, tuple[np.ndarray, np.ndarray | None]] = {}
    for image in index["images"]:
        shape = (image["height"], image["width"])
        labels = np.fromfile(folder / f"{image['name']}.labels", "<u2").reshape(shape)
        ignore = None
        if image.get("ignore"):
            ignore = np.fromfile(folder / f"{image['name']}.ignore", np.uint8).reshape(shape) > 0
        images[image["name"]] = (labels.astype(np.int32), ignore)
    return images


@pytest.mark.skipif(
    not (POC_FIXTURES / "tnbc" / "results" / "region.all.json").exists(),
    reason="the POC's TNBC fixtures and results are not on this machine",
)
@pytest.mark.parametrize("method", REPRODUCED)
def test_the_scorer_reproduces_the_poc_numbers_on_tnbc(method: str) -> None:
    images = load("tnbc")
    expected = json.loads((POC_FIXTURES / "tnbc" / "results" / "region.all.json").read_text())[
        method
    ]
    scores = []
    for line in (POC_FIXTURES / "tnbc" / "results" / f"{method}.jsonl").read_text().splitlines():
        if line.strip():
            record = json.loads(line)
            labels, ignore = images[record["image"]]
            scores.append(score_image(labels, record["rings"], ignore))
    summary = summarise(scores)
    assert (summary.nuclei, summary.predicted) == (expected["nuclei"], expected["predicted"])
    for metric in ("recall", "precision", "f1", "pq", "sq"):
        assert getattr(summary, metric) == pytest.approx(expected[metric], abs=1e-9), metric
