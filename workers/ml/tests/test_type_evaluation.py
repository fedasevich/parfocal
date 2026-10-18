import os
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.type_evaluation import bands_of, ece, evaluate, fit_temperature, mapped, scaled

PANNUKE = (
    Path(
        os.environ.get(
            "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
        )
    )
    / "pannuke"
)
VIEWS = 8


def test_balanced_accuracy_weighs_every_class_equally() -> None:
    probabilities = np.array([[0.9, 0.1], [0.8, 0.2], [0.7, 0.3], [0.2, 0.8]])
    labels = np.array([0, 0, 1, 1])
    result = evaluate(probabilities, labels, probabilities, labels, ("a", "b"))
    assert result.accuracy == pytest.approx(0.75)
    assert result.balanced_accuracy == pytest.approx((1.0 + 0.5) / 2)
    assert result.confusion == [[2, 0], [1, 1]]
    assert result.precision == {"a": pytest.approx(2 / 3), "b": 1.0}


def test_ece_is_zero_when_confidence_matches_accuracy() -> None:
    probabilities = np.array([[0.75, 0.25]] * 4)
    assert ece(probabilities, np.array([0, 0, 0, 1])) == pytest.approx(0.0)
    assert ece(probabilities, np.array([1, 1, 1, 1])) == pytest.approx(0.75)


def test_temperature_scaling_keeps_the_call_and_softens_it() -> None:
    probabilities = np.array([[0.9, 0.1]])
    softer = scaled(probabilities, 2.0)
    assert softer.argmax() == 0
    assert softer[0, 0] == pytest.approx(0.75)
    labels = np.array([0, 0, 0, 1] * 25)
    overconfident = np.array([[0.99, 0.01]] * 100)
    assert fit_temperature(overconfident, labels) > 1


def test_bands_split_calls_by_calibrated_confidence() -> None:
    probabilities = np.array([[0.85, 0.15], [0.6, 0.4], [0.45, 0.55], [0.39, 0.61]])
    bands = bands_of(probabilities, np.array([0, 1, 1, 1]))
    assert [(band.name, band.share) for band in bands] == [
        ("confident", 0.25),
        ("likely", 0.75),
        ("unsure", 0.0),
        ("doubtful", 0.0),
    ]


def test_dataset_classes_map_to_viewer_classes() -> None:
    assert mapped(np.array([0, 1, 2, 3, 4]), [0, 2, 1, 3, 3]).tolist() == [0, 2, 1, 3, 3]


def cached(split: str, views: int) -> tuple[np.ndarray, np.ndarray]:
    labels = np.fromfile(PANNUKE / f"hovernext-{split}.labels.u8", np.uint8).astype(np.int64)
    probabilities = np.fromfile(PANNUKE / f"hovernext-{split}.views.f32", np.float32).reshape(
        len(labels), VIEWS, 4
    )
    return probabilities[:, :views].mean(axis=1).astype(np.float64), labels


@pytest.mark.skipif(
    not (PANNUKE / "hovernext-test.views.f32").exists(),
    reason="the POC's cached HoVer-NeXt outputs on PanNuke are not on this machine",
)
@pytest.mark.parametrize(
    ("views", "accuracy", "balanced", "temperature", "before", "after", "bands"),
    [
        (
            1,
            0.830,
            0.817,
            1.42,
            0.032,
            0.022,
            [(0.594, 0.95), (0.278, 0.722), (0.117, 0.512), (0.011, 0.438)],
        ),
        (
            8,
            0.835,
            0.821,
            1.29,
            0.020,
            0.019,
            [(0.608, 0.955), (0.275, 0.706), (0.105, 0.523), (0.012, 0.442)],
        ),
    ],
)
def test_the_harness_reproduces_doc_29_for_hovernext_on_fold_3(
    views: int,
    accuracy: float,
    balanced: float,
    temperature: float,
    before: float,
    after: float,
    bands: list[tuple[float, float]],
) -> None:
    fit, fit_labels = cached("train", views)
    test, labels = cached("test", views)
    result = evaluate(fit, fit_labels, test, labels)
    assert result.nuclei == 12928
    assert round(result.accuracy, 3) == accuracy
    assert round(result.balanced_accuracy, 3) == balanced
    assert result.temperature == temperature
    assert (round(result.ece_before, 3), round(result.ece_after, 3)) == (before, after)
    assert [(round(band.share, 3), round(band.accuracy or 0, 3)) for band in result.bands] == bands
    if views == 1:
        assert [round(100 * (result.recall[name] or 0)) for name in result.recall] == [
            88,
            78,
            76,
            84,
        ]
        assert [round(100 * (result.precision[name] or 0)) for name in result.precision] == [
            90,
            76,
            75,
            84,
        ]
