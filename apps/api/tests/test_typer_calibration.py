import pytest

from parfocal_api.model_catalogue import (
    BAND_CUTOFFS,
    BY_NAME,
    CALIBRATIONS,
    ConfidenceBand,
    calibration_of,
)
from parfocal_api.model_tiers import DEFAULTS
from parfocal_api.tables import TierTask
from parfocal_common.model_runs import ModelTier
from parfocal_common.review_order import UNCALIBRATED


def test_the_active_typer_is_calibrated_for_every_view_count_under_five_percent_ece() -> None:
    active = BY_NAME[DEFAULTS[(TierTask.TYPER, ModelTier.BEST)]]
    for views in (1, 8):
        calibration = calibration_of(active.name, active.version, views)
        assert calibration is not None
        assert calibration.ece_after < 0.05
        assert calibration.temperature != UNCALIBRATED
        assert calibration.test_set_accuracy >= 0.7
        assert calibration.test_set_unsure_share < calibration.test_set_confident_share


def test_every_calibration_names_a_catalogue_typer_and_one_scalar_temperature() -> None:
    for (name, version, views), calibration in CALIBRATIONS.items():
        assert BY_NAME[name].version == version
        assert views in (1, 8)
        assert isinstance(calibration.temperature, float)


def test_an_unknown_typer_or_view_count_has_no_calibration() -> None:
    assert calibration_of("hovernet", "v0.9", 1) is None
    assert calibration_of("pathosam-hovernext", "v1.2", 4) is None


@pytest.mark.parametrize(
    ("views", "recorded"),
    [
        (1, [(0.594, 0.950), (0.278, 0.722), (0.117, 0.512), (0.011, 0.438)]),
        (8, [(0.608, 0.955), (0.275, 0.706), (0.105, 0.523), (0.012, 0.442)]),
    ],
)
def test_the_hovernext_bands_hold_the_shares_and_accuracies_mleval_reported(
    views: int, recorded: list[tuple[float, float]]
) -> None:
    calibration = calibration_of("pathosam-hovernext", "v1.2", views)
    assert calibration is not None
    assert [(row.share, row.accuracy) for row in calibration.bands] == recorded
    assert [(row.band, row.lowest) for row in calibration.bands] == list(BAND_CUTOFFS)


def test_every_typer_band_table_is_consistent_with_its_test_set() -> None:
    for calibration in CALIBRATIONS.values():
        shares = [row.share for row in calibration.bands]
        assert sum(shares) == pytest.approx(1, abs=0.002)
        assert shares[0] == pytest.approx(calibration.test_set_confident_share, abs=0.0005)
        weighted = sum(row.share * (row.accuracy or 0) for row in calibration.bands)
        assert weighted == pytest.approx(calibration.test_set_accuracy, abs=0.002)
        accuracies = [row.accuracy or 0 for row in calibration.bands]
        assert accuracies == sorted(accuracies, reverse=True)


def test_a_probability_falls_in_the_band_of_its_cutoffs() -> None:
    calibration = calibration_of("pathosam-hovernext", "v1.2", 1)
    assert calibration is not None
    assert [calibration.band_of(p) for p in (0.95, 0.8, 0.79, 0.55, 0.5, 0.4, 0.39, 0.25)] == [
        ConfidenceBand.CONFIDENT,
        ConfidenceBand.CONFIDENT,
        ConfidenceBand.LIKELY,
        ConfidenceBand.LIKELY,
        ConfidenceBand.UNSURE,
        ConfidenceBand.UNSURE,
        ConfidenceBand.DOUBTFUL,
        ConfidenceBand.DOUBTFUL,
    ]
    assert calibration.band_accuracy() == {
        ConfidenceBand.CONFIDENT: 0.950,
        ConfidenceBand.LIKELY: 0.722,
        ConfidenceBand.UNSURE: 0.512,
        ConfidenceBand.DOUBTFUL: 0.438,
    }
