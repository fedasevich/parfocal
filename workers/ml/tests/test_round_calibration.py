import os
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.round_calibration import (
    MIN_SIDE_NUCLEI,
    NotCalibratedError,
    NotEnoughHeldOutError,
    RoundOutputs,
    catalogue_row,
    fits_temperature,
    main,
    poc_round,
    promote,
    recalibrate,
    train_head,
)

PANNUKE = (
    Path(
        os.environ.get(
            "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
        )
    )
    / "pannuke"
)


def synthetic_round(
    slides: int, per_slide: int, sharpen: float, seed: int = 3, version: str = "v1.2-round-1"
) -> RoundOutputs:
    generator = np.random.default_rng(seed)
    count = slides * per_slide
    truth = generator.integers(0, 4, count)
    logits = generator.normal(0, 1, (count, 4))
    logits[np.arange(count), truth] += 1.5
    probabilities = np.exp(sharpen * logits)
    probabilities /= probabilities.sum(axis=1, keepdims=True)
    keys = [f"slide-{index // per_slide}" for index in range(count)]
    return RoundOutputs("typer", version, 1, probabilities, truth, keys)


def everything_held_out(_: str) -> bool:
    return True


def test_a_round_gets_a_temperature_and_four_bands_from_its_held_out_slides() -> None:
    fitted = recalibrate(synthetic_round(60, 100, 3), everything_held_out)
    calibration = fitted.calibration
    assert (calibration.typer, calibration.version) == ("typer", "v1.2-round-1")
    assert calibration.temperature > 2
    assert calibration.ece_after < 0.05 < calibration.ece_before
    assert [band.name for band in calibration.bands] == [
        "confident",
        "likely",
        "unsure",
        "doubtful",
    ]
    assert sum(band.share for band in calibration.bands) == pytest.approx(1)
    assert fitted.fit_slides + fitted.test_slides == 60
    assert calibration.fit_nuclei + calibration.test_nuclei == 6000


def test_fit_and_measure_slides_never_overlap_and_keep_their_side() -> None:
    outputs = synthetic_round(60, 100, 3)
    fit_side = {slide for slide in outputs.slides if fits_temperature(slide)}
    fitted = recalibrate(outputs, everything_held_out)
    assert fitted.fit_slides == len(fit_side)
    assert fitted.calibration.fit_nuclei == 100 * len(fit_side)
    later = synthetic_round(90, 100, 2, seed=4, version="v1.2-round-2")
    assert {slide for slide in later.slides if fits_temperature(slide)} >= fit_side
    assert fits_temperature("slide-0") == fits_temperature("slide-0")


def test_input_order_changes_nothing() -> None:
    outputs = synthetic_round(60, 100, 3)
    order = np.random.default_rng(9).permutation(len(outputs.labels))
    shuffled = RoundOutputs(
        outputs.typer,
        outputs.round_version,
        outputs.test_time_views,
        outputs.probabilities[order],
        outputs.labels[order],
        [str(outputs.slides[index]) for index in order.tolist()],
    )
    first = recalibrate(outputs, everything_held_out).calibration
    second = recalibrate(shuffled, everything_held_out).calibration
    assert first.temperature == second.temperature
    assert first.ece_after == pytest.approx(second.ece_after)


def test_slides_the_round_trained_on_are_refused() -> None:
    outputs = synthetic_round(60, 100, 3)
    with pytest.raises(NotEnoughHeldOutError, match="training side"):
        recalibrate(outputs, lambda slide: slide != "slide-7")


def test_too_few_held_out_nuclei_or_slides_are_refused() -> None:
    with pytest.raises(NotEnoughHeldOutError, match="needs"):
        recalibrate(synthetic_round(60, MIN_SIDE_NUCLEI // 60, 3), everything_held_out)
    with pytest.raises(NotEnoughHeldOutError, match="needs"):
        recalibrate(synthetic_round(4, 1000, 3), everything_held_out)


def test_mismatched_rows_are_refused() -> None:
    outputs = synthetic_round(60, 100, 3)
    broken = RoundOutputs("typer", "v", 1, outputs.probabilities, outputs.labels, ["a"])
    with pytest.raises(ValueError, match="one row per nucleus"):
        recalibrate(broken, everything_held_out)


def test_only_a_calibrated_round_can_be_promoted() -> None:
    fitted = recalibrate(synthetic_round(60, 100, 3), everything_held_out)
    promoted = promote("typer", "v1.2-round-1", [fitted])
    assert promoted.calibrations == (fitted,)
    with pytest.raises(NotCalibratedError, match="no fitted temperature"):
        promote("typer", "v1.2-round-1", [])
    with pytest.raises(NotCalibratedError, match=r"calibration of typer v1\.2-round-1"):
        promote("typer", "v1.2-round-2", [fitted])
    with pytest.raises(NotCalibratedError, match="one view count"):
        promote("typer", "v1.2-round-1", [fitted, fitted])


def test_the_catalogue_row_rounds_as_the_stored_rows_do() -> None:
    row = catalogue_row(recalibrate(synthetic_round(60, 100, 3), everything_held_out))
    assert row["version"] == "v1.2-round-1"
    bands = row["bands"]
    assert isinstance(bands, list)
    assert [band["band"] for band in bands] == ["confident", "likely", "unsure", "doubtful"]
    assert [band["lowest"] for band in bands] == [0.8, 0.55, 0.4, 0.0]
    assert all(band["share"] == round(band["share"], 3) for band in bands)


def test_a_round_file_on_disk_is_recalibrated(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    outputs = synthetic_round(60, 100, 3)
    path = tmp_path / "round.npz"
    np.savez(
        path,
        probabilities=outputs.probabilities,
        labels=outputs.labels,
        slides=np.array(outputs.slides),
    )
    main(["round", str(path), "--typer", "typer", "--version", "v1.2-round-1"])
    assert '"temperature"' in capsys.readouterr().out
    np.savez(
        path,
        probabilities=outputs.probabilities,
        labels=outputs.labels,
        slides=np.array(outputs.slides),
        trained_slides=np.array(["slide-3"]),
    )
    with pytest.raises(NotEnoughHeldOutError):
        main(["round", str(path), "--typer", "typer", "--version", "v1.2-round-1"])


def test_the_head_learns_a_separable_problem() -> None:
    generator = np.random.default_rng(5)
    labels = generator.integers(0, 3, 600)
    features = generator.normal(0, 0.3, (600, 3)) + np.eye(3)[labels]
    predict = train_head(features, labels, 3)
    assert (predict(features).argmax(axis=1) == labels).mean() > 0.95


@pytest.mark.skipif(
    not (PANNUKE / "pathosam-features.npz").exists(),
    reason="the POC's cached PanNuke outputs are not on this machine",
)
def test_a_trained_round_on_pannuke_needs_its_own_temperature() -> None:
    measured = poc_round(PANNUKE, "pathosam-hovernext", "v1.2-round-1", 1.29)
    refit = measured["refit"]
    stale = measured["stale_temperature"]
    leaked = measured["fitted_on_training_side"]
    assert isinstance(refit, dict)
    assert isinstance(stale, dict)
    assert isinstance(leaked, dict)
    assert refit["temperature"] == 1.79
    assert refit["ece"] == 0.0187
    assert stale["ece"] == 0.0892
    assert leaked["ece"] == 0.1
    assert refit["ece"] < 0.05 < stale["ece"]
