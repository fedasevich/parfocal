import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_decisions import Called, behind_the_triggers, called, decide
from workspace_support import owner

from parfocal_api.model_catalogue import ConfidenceBand, band_at, calibration_of
from parfocal_api.track_record import (
    MIN_BAND_CHECKS,
    MIN_CHECKS,
    TyperKey,
    Withheld,
    band_split,
    typer_record,
)

HOVERNEXT = TyperKey("pathosam-hovernext", "v1.2", 1)
UPLOADED = TyperKey("lab-typer", "v3", 1)
CONFIDENT = 240
LIKELY = 170
UNSURE = 120
DOUBTFUL = 60


def calls(score: int, kept: int, overturned: int) -> list[tuple[int, bool, int]]:
    return [(score, True, kept), (score, False, overturned)]


@pytest.mark.parametrize(
    ("score", "band"),
    [
        (255, ConfidenceBand.CONFIDENT),
        (204, ConfidenceBand.CONFIDENT),
        (203, ConfidenceBand.LIKELY),
        (141, ConfidenceBand.LIKELY),
        (140, ConfidenceBand.UNSURE),
        (102, ConfidenceBand.UNSURE),
        (101, ConfidenceBand.DOUBTFUL),
        (0, ConfidenceBand.DOUBTFUL),
    ],
)
def test_each_saved_score_falls_in_the_band_of_its_cutoffs(
    score: int, band: ConfidenceBand
) -> None:
    calibration = calibration_of(HOVERNEXT.typer, HOVERNEXT.typer_version or "", 1)
    split = band_split(calibration, [(score, True, 1)])
    assert split[band].checked == 1
    assert sum(tally.checked for tally in split.values()) == 1
    assert band_at(score / 255) is band


def test_the_band_split_counts_kept_and_overturned_calls_per_band() -> None:
    record = typer_record(
        HOVERNEXT,
        [*calls(CONFIDENT, 9, 1), *calls(LIKELY, 7, 3), *calls(UNSURE, 2, 2), (DOUBTFUL, False, 1)],
    )
    by_band = {row.band: row for row in record.bands}
    assert [row.band for row in record.bands] == list(ConfidenceBand)
    assert (by_band[ConfidenceBand.CONFIDENT].checked, by_band[ConfidenceBand.CONFIDENT].kept) == (
        10,
        9,
    )
    assert by_band[ConfidenceBand.CONFIDENT].kept_share == pytest.approx(0.9)
    assert by_band[ConfidenceBand.LIKELY].kept_share == pytest.approx(0.7)
    assert by_band[ConfidenceBand.UNSURE].checked == 4
    assert by_band[ConfidenceBand.UNSURE].kept_share is None
    assert by_band[ConfidenceBand.DOUBTFUL].kept_share is None
    assert (record.checked, record.kept) == (25, 18)


def test_each_band_shows_the_accuracy_recorded_for_the_typer() -> None:
    record = typer_record(HOVERNEXT, calls(CONFIDENT, 1, 0))
    calibration = calibration_of("pathosam-hovernext", "v1.2", 1)
    assert calibration is not None
    recorded = {row.band: row for row in calibration.bands}
    assert record.calibrated
    for row in record.bands:
        assert row.recorded_accuracy == recorded[row.band].accuracy
        assert row.recorded_share == recorded[row.band].share


def test_eight_views_reads_its_own_recorded_accuracies() -> None:
    one = typer_record(HOVERNEXT, calls(CONFIDENT, 1, 0))
    eight = typer_record(TyperKey("pathosam-hovernext", "v1.2", 8), calls(CONFIDENT, 1, 0))
    assert one.bands[0].recorded_accuracy != eight.bands[0].recorded_accuracy


def test_the_overall_figure_waits_for_enough_checks() -> None:
    few = MIN_CHECKS - 1
    record = typer_record(
        HOVERNEXT,
        [
            *calls(CONFIDENT, MIN_BAND_CHECKS, 0),
            *calls(LIKELY, MIN_BAND_CHECKS, 0),
            *calls(UNSURE, few - 2 * MIN_BAND_CHECKS, 0),
        ],
    )
    assert record.checked == few
    assert record.overall_kept_share is None
    assert record.overall_withheld is Withheld.TOO_FEW_CHECKS


def test_the_overall_figure_waits_until_every_band_that_matters_is_checked() -> None:
    record = typer_record(HOVERNEXT, [*calls(UNSURE, 10, 10), *calls(DOUBTFUL, 5, 5)])
    assert record.checked == 30
    assert record.overall_kept_share is None
    assert record.overall_withheld is Withheld.BANDS_UNCHECKED
    assert record.unchecked_bands == [ConfidenceBand.CONFIDENT, ConfidenceBand.LIKELY]


def test_a_band_with_too_few_checks_still_counts_as_unchecked() -> None:
    record = typer_record(
        HOVERNEXT,
        [
            *calls(CONFIDENT, 15, 0),
            *calls(LIKELY, MIN_BAND_CHECKS - 1, 0),
            *calls(UNSURE, 5, 0),
        ],
    )
    assert record.overall_withheld is Withheld.BANDS_UNCHECKED
    assert record.unchecked_bands == [ConfidenceBand.LIKELY]


def test_a_rare_band_does_not_hold_back_the_overall_figure() -> None:
    record = typer_record(
        HOVERNEXT, [*calls(CONFIDENT, 19, 1), *calls(LIKELY, 7, 3), *calls(UNSURE, 3, 2)]
    )
    assert record.unchecked_bands == []
    assert record.overall_withheld is None
    assert record.overall_kept_share is not None


def test_the_overall_figure_weights_bands_by_the_recorded_mix_not_the_queue() -> None:
    queue = [
        *calls(CONFIDENT, 5, 0),
        *calls(LIKELY, 4, 1),
        *calls(UNSURE, 48, 52),
        *calls(DOUBTFUL, 45, 55),
    ]
    record = typer_record(HOVERNEXT, queue)
    assert record.kept / record.checked < 0.5
    calibration = calibration_of("pathosam-hovernext", "v1.2", 1)
    assert calibration is not None
    shares = {row.band: row.share for row in calibration.bands}
    expected = (
        shares[ConfidenceBand.CONFIDENT] * 1.0
        + shares[ConfidenceBand.LIKELY] * 0.8
        + shares[ConfidenceBand.UNSURE] * 0.48
        + shares[ConfidenceBand.DOUBTFUL] * 0.45
    ) / sum(shares.values())
    assert record.overall_kept_share == pytest.approx(expected)
    assert expected > 0.8


def test_a_typer_with_no_recorded_calibration_splits_bands_but_gives_no_overall() -> None:
    record = typer_record(
        UPLOADED,
        [
            *calls(CONFIDENT, 10, 0),
            *calls(LIKELY, 10, 0),
            *calls(UNSURE, 10, 0),
            *calls(DOUBTFUL, 10, 0),
        ],
    )
    assert not record.calibrated
    assert all(row.kept_share == 1.0 for row in record.bands)
    assert all(row.recorded_accuracy is None for row in record.bands)
    assert record.overall_kept_share is None
    assert record.overall_withheld is Withheld.UNCALIBRATED


def decided(api: ApiAs, database: str) -> Called:
    c = called(api, database)
    for number, (value, score) in enumerate(
        [("agree", 240), ("disagree", 240), ("agree", 170), ("unsure", 120)], start=1
    ):
        body: dict[str, Any] = {"value": value, "ai_class_id": c.tumor, "ai_score": score}
        if value == "disagree":
            body |= {"reasons": ["wrong_class"], "reason_class_id": str(c.stroma)}
        assert decide(api, c, f"C{number}", body).status_code == 200
    assert decide(api, c, "C5", {"value": "agree"}).status_code == 200
    assert decide(api, c, "T1", {"value": "agree"}).status_code == 200
    return c


def record_of(api: ApiAs, c: Called, who: str = "first", **params: str) -> list[Any]:
    response = api(c.r.people[who]).get("/api/me/track-record", params=params)
    assert response.status_code == 200, response.text
    return response.json()["typers"]


@pytest.mark.db
def test_the_track_record_counts_each_reviewers_own_cell_calls_per_typer(
    api: ApiAs, database: str
) -> None:
    c = decided(api, database)
    [typer] = record_of(api, c)
    assert (typer["typer"], typer["calibrated"], typer["checked"], typer["kept"]) == (
        "HoVer-NeXt",
        False,
        3,
        2,
    )
    bands = {row["band"]: row["checked"] for row in typer["bands"]}
    assert bands == {"confident": 2, "likely": 1, "unsure": 0, "doubtful": 0}
    assert typer["overall_withheld"] == "uncalibrated"
    assert record_of(api, c, "second") == []
    assert record_of(api, c, project_id=str(uuid.uuid4())) == []


@pytest.mark.db
def test_the_track_record_shows_the_recorded_accuracy_of_a_calibrated_typer(
    api: ApiAs, database: str
) -> None:
    c = decided(api, database)
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{c.r.project}'")[0][0]
    job = owner(
        database,
        "INSERT INTO jobs (tenant_id, project_id, kind) "
        f"VALUES ('{tenant}', '{c.r.project}', 'model-run') RETURNING id",
    )[0][0]
    owner(
        database,
        "INSERT INTO model_runs (job_id, tenant_id, project_id, slide_id, batch_id, scope_kind, "
        "detector, detector_version, typer, typer_version, test_time_views, ordering) "
        f"VALUES ('{job}', '{tenant}', '{c.r.project}', '{c.r.slide}', '{uuid.uuid4()}', "
        "'slide', 'pathosam', 'v1', 'pathosam-hovernext', 'v1.2', 8, 'raster')",
    )
    behind_the_triggers(
        database, f"UPDATE result_sets SET job_id = '{job}' WHERE id = '{c.r.result_set}';"
    )
    [typer] = record_of(api, c, project_id=str(c.r.project))
    assert (typer["typer"], typer["typer_version"], typer["test_time_views"]) == (
        "pathosam-hovernext",
        "v1.2",
        8,
    )
    assert typer["calibrated"]
    calibration = calibration_of("pathosam-hovernext", "v1.2", 8)
    assert calibration is not None
    assert [row["recorded_accuracy"] for row in typer["bands"]] == [
        row.accuracy for row in calibration.bands
    ]
    assert typer["overall_withheld"] == "too-few-checks"
    assert typer["unchecked_bands"] == ["confident", "likely", "unsure"]
