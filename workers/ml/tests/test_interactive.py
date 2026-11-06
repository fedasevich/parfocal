import json
import os
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from parfocal_ml.datasets import Sample
from parfocal_ml.interactive import (
    MODES,
    NOC_CAP,
    REFINE_EVERY,
    Instance,
    Logits,
    Prompt,
    Prompter,
    compare,
    evaluate,
    instances,
    next_click,
    resampled,
    ring_of,
    score_ring,
    summarise,
)

POC_FIXTURES = Path(
    os.environ.get(
        "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
    )
)
POC_TNBC = POC_FIXTURES / "tnbc"


def disks(size: int = 128) -> NDArray[np.int32]:
    labels = np.zeros((size, size), np.int32)
    ys, xs = np.mgrid[0:size, 0:size]
    centres = [(30, 30, 9), (90, 30, 11), (30, 90, 7), (90, 90, 12), (60, 60, 8)]
    for number, (cx, cy, radius) in enumerate(centres, start=1):
        labels[(xs - cx) ** 2 + (ys - cy) ** 2 <= radius**2] = number
    return labels


def instance_of(labels: NDArray[np.int32], number: int) -> Instance:
    return next(found for found in instances("disks", labels) if found.id == number)


class Oracle:
    def __init__(self, labels: NDArray[np.int32], shrink: int = 0) -> None:
        self.labels = labels
        self.shrink = shrink

    def prepare(self, rgb: NDArray[np.uint8]) -> Prompter:
        def prompter(prompt: Prompt, previous: Logits | None) -> Logits:
            if prompt.box is not None:
                x0, y0, x1, y1 = prompt.box
                number = int(self.labels[(y0 + y1) // 2, (x0 + x1) // 2])
            else:
                x, y = prompt.positives[0]
                number = int(self.labels[y, x])
            inside = (self.labels == number).astype(np.float32)
            height, width = inside.shape
            coarse = inside.reshape(height // 4, 4, width // 4, 4).mean(axis=(1, 3))
            logits = (coarse - 0.5) * 16
            if self.shrink and previous is None and prompt.box is None:
                logits -= self.shrink
            return logits.astype(np.float32)

        return prompter


def test_a_ring_on_the_true_edge_scores_one() -> None:
    labels = np.zeros((20, 20), np.int32)
    labels[4:10, 5:12] = 1
    found = instance_of(labels, 1)
    assert score_ring([4.5, 3.5, 11.5, 3.5, 11.5, 9.5, 4.5, 9.5], labels, found) == pytest.approx(
        1.0
    )


def test_a_ring_through_pixel_centres_scores_below_one() -> None:
    labels = np.zeros((20, 20), np.int32)
    labels[4:10, 5:12] = 1
    found = instance_of(labels, 1)
    iou = score_ring([5, 4, 11, 4, 11, 9, 5, 9], labels, found)
    assert iou == pytest.approx(30 / 42, abs=0.05)


def test_no_ring_scores_zero() -> None:
    labels = disks()
    assert score_ring(None, labels, instance_of(labels, 1)) == 0.0


def test_resampling_keeps_pixel_centres() -> None:
    logits = np.arange(16, dtype=np.float32).reshape(4, 4)
    field = resampled(logits, 8, 8)
    assert field.shape == (8, 8)
    assert field[0, 0] == pytest.approx(0.0)
    assert field[1, 1] == pytest.approx(
        logits[0, 0] * 0.5625
        + logits[0, 1] * 0.1875
        + logits[1, 0] * 0.1875
        + logits[1, 1] * 0.0625
    )
    assert field[7, 7] == pytest.approx(15.0)


def test_the_ring_follows_the_component_under_the_click() -> None:
    field = np.full((40, 40), -4.0, np.float32)
    field[5:15, 5:15] = 4.0
    field[20:36, 20:36] = 4.0
    ring = ring_of(field, (8, 8))
    assert ring is not None
    xs, ys = ring[0::2], ring[1::2]
    assert 4 < min(xs) < 5
    assert 14 < max(xs) < 15
    assert 4 < min(ys) < 5
    assert 14 < max(ys) < 15
    largest = ring_of(field, None)
    assert largest is not None
    assert max(largest[0::2]) > 35


def test_an_empty_field_has_no_ring() -> None:
    assert ring_of(np.full((10, 10), -1.0, np.float32), (5, 5)) is None


def test_the_next_click_goes_to_the_deepest_miss() -> None:
    truth = np.zeros((30, 30), bool)
    truth[5:25, 5:25] = True
    predicted = np.zeros((30, 30), bool)
    predicted[5:25, 5:12] = True
    click = next_click(truth, predicted)
    assert click is not None
    (x, y), positive = click
    assert positive
    assert x > 12
    assert 5 < y < 25
    assert next_click(truth, truth) is None


def test_prompts_skip_small_and_edge_nuclei() -> None:
    labels = disks()
    labels[0:4, 60:64] = 6
    labels[110:113, 10:13] = 7
    found = {instance.id: instance for instance in instances("disks", labels)}
    assert set(found) == {1, 2, 3, 4, 5}
    for instance in found.values():
        assert labels[instance.ideal[1], instance.ideal[0]] == instance.id
        assert labels[instance.realistic[1], instance.realistic[0]] == instance.id
        x0, y0, x1, y1 = instance.loose
        assert x0 < instance.box[2]
        assert y0 < instance.box[3]
        assert x1 > instance.box[0]
        assert y1 > instance.box[1]


def test_prompts_are_seeded_by_the_image_name() -> None:
    labels = disks()
    assert instances("a", labels) == instances("a", labels)
    assert [i.loose for i in instances("a", labels)] != [i.loose for i in instances("b", labels)]


def test_the_protocol_runs_every_mode_on_an_oracle() -> None:
    labels = disks()
    sample = Sample(
        name="disks", rgb=np.zeros((128, 128, 3), np.uint8), labels=labels, ignore=None, group=None
    )
    outcomes = evaluate(sample, Oracle(labels, shrink=6).prepare(sample.rgb))
    assert len(outcomes) == 5
    refined = [o for o in outcomes if o.id % REFINE_EVERY == 0]
    assert [o.id for o in refined] == [4]
    assert set(refined[0].ious) == set(MODES)
    assert 1 <= len(refined[0].trajectory) <= NOC_CAP
    assert refined[0].trajectory[1] > refined[0].trajectory[0]
    summary = summarise(outcomes)
    modes = summary["modes"]
    assert isinstance(modes, dict)
    assert modes["exact_box"]["count"] == 5
    assert modes["exact_box"]["mean"] > 0.85
    noc = summary["noc"]
    assert isinstance(noc, dict)
    assert noc["85"]["count"] == 1


def test_compare_flags_modes_outside_the_tolerance() -> None:
    summary: dict[str, object] = {
        "modes": {"exact_box": {"mean": 0.86}, "loose_box": {"mean": 0.79}},
    }
    result = compare(summary, {"exact_box": 0.8632, "loose_box": 0.8167}, 0.01)
    assert result["exact_box"]["within"] is True
    assert result["loose_box"]["within"] is False


@pytest.mark.skipif(not (POC_TNBC / "index.json").exists(), reason="POC TNBC fixtures absent")
def test_prompts_match_the_poc_fixture() -> None:
    index = json.loads((POC_TNBC / "index.json").read_text())
    for image in index["images"][:6]:
        shape = (image["height"], image["width"])
        labels = (
            np.fromfile(POC_TNBC / f"{image['name']}.labels", "<u2").reshape(shape).astype(np.int32)
        )
        ours = instances(image["name"], labels)
        assert [i.id for i in ours] == [i["id"] for i in image["instances"]]
        for mine, theirs in zip(ours, image["instances"], strict=True):
            assert list(mine.ideal) == theirs["click"]
            assert list(mine.realistic) == theirs["jclick"]
            assert list(mine.box) == theirs["box"]
            assert list(mine.loose) == theirs["jbox"]


POC_SCORES = POC_TNBC / "results" / "pathosam-uint8-contour.scores.jsonl"
WEIGHTS_IMAGES = 2


@pytest.mark.weights
@pytest.mark.skipif(not POC_SCORES.exists(), reason="POC TNBC scores absent")
def test_onnx_prompts_reproduce_the_poc_on_the_same_nuclei() -> None:
    pytest.importorskip("onnxruntime")
    from itertools import islice

    from parfocal_ml.datasets import samples
    from parfocal_ml.interactive import TOLERANCE, OnnxSam, poc_means, run
    from parfocal_ml.sam_contract import GRAPHS, onnx_dir

    if not (onnx_dir() / GRAPHS.encoder_uint8).exists():
        pytest.skip("PathoSAM ONNX graphs absent, run pnpm --filter @parfocal/ml export:sam")
    try:
        images = list(islice(samples("tnbc"), WEIGHTS_IMAGES))
    except Exception as missing:
        pytest.skip(str(missing))
    outcomes = list(run(OnnxSam(GRAPHS.encoder_uint8), images, noc=False))
    expected = poc_means(POC_SCORES, {sample.name for sample in images})
    result = compare(summarise(outcomes), expected, TOLERANCE)
    assert all(row["within"] for row in result.values()), result
