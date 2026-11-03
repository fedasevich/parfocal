import os
from pathlib import Path

import numpy as np
import pytest

from parfocal_api.model_catalogue import calibration_of
from parfocal_ml.calibration import calibrate, poc_calibrations, unsure_share, validated_sites

PANNUKE = (
    Path(
        os.environ.get(
            "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
        )
    )
    / "pannuke"
)


def overconfident(count: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    generator = np.random.default_rng(seed)
    truth = generator.integers(0, 3, count)
    logits = generator.normal(0, 1, (count, 3))
    logits[np.arange(count), truth] += 1.5
    probabilities = np.exp(4 * logits)
    probabilities /= probabilities.sum(axis=1, keepdims=True)
    return probabilities, truth


def test_a_temperature_fitted_on_one_split_calibrates_another() -> None:
    fit, fit_labels = overconfident(4000, 1)
    test, labels = overconfident(4000, 2)
    sites = np.arange(4000) % 2
    result = calibrate("typer", "v1", 1, fit, fit_labels, test, labels, sites, ("a", "b"))
    assert result.temperature > 2
    assert result.ece_after < 0.05 < result.ece_before
    assert result.fit_nuclei == result.test_nuclei == 4000
    assert result.test_set_accuracy == pytest.approx((test.argmax(axis=1) == labels).mean())
    assert 0 < result.test_set_confident_share < 1
    assert result.validated_sites == ("a", "b")


def test_unsure_means_doubtful_or_close_as_the_viewer_counts_it() -> None:
    probabilities = np.array(
        [[0.9, 0.05, 0.05], [0.5, 0.45, 0.05], [0.35, 0.33, 0.32], [0.6, 0.3, 0.1]]
    )
    assert unsure_share(probabilities) == pytest.approx(0.5)


def test_a_site_needs_enough_nuclei_typed_well_enough() -> None:
    probabilities = np.tile([[0.9, 0.1]], (450, 1))
    labels = np.array([0] * 150 + [0] * 130 + [1] * 70 + [0] * 99 + [1])
    sites = np.array([0] * 150 + [1] * 200 + [2] * 100)
    assert validated_sites(probabilities, labels, sites, ("kept", "too wrong", "kept too")) == (
        "kept",
        "kept too",
    )


@pytest.mark.skipif(
    not (PANNUKE / "hovernext-test.views.f32").exists(),
    reason="the POC's cached HoVer-NeXt outputs on PanNuke are not on this machine",
)
def test_the_registry_holds_what_the_fit_gives_on_pannuke() -> None:
    for fitted in poc_calibrations(PANNUKE, "pathosam-hovernext", "v1.2"):
        stored = calibration_of(fitted.typer, fitted.version, fitted.test_time_views)
        assert stored is not None
        assert stored.temperature == fitted.temperature
        assert stored.ece_after == round(fitted.ece_after, 4)
        assert stored.ece_after < 0.05
        assert stored.test_set_accuracy == round(fitted.test_set_accuracy, 4)
        assert stored.test_set_confident_share == round(fitted.test_set_confident_share, 4)
        assert stored.test_set_unsure_share == round(fitted.test_set_unsure_share, 4)
        assert stored.validated_sites == fitted.validated_sites
