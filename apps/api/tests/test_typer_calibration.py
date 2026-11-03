from parfocal_api.model_catalogue import BY_NAME, CALIBRATIONS, calibration_of
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
