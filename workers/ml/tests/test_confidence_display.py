import os
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.confidence_display import (
    auroc,
    calls_of,
    patch_regions,
    poc_replay,
    share_ranges,
    side,
)

PANNUKE = (
    Path(
        os.environ.get(
            "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
        )
    )
    / "pannuke"
)
needs_cached_outputs = pytest.mark.skipif(
    not (PANNUKE / "hovernext-test.views.f32").exists(),
    reason="the POC's cached HoVer-NeXt outputs are not on this machine",
)


def test_calls_band_and_flag_unsure_cells() -> None:
    calls = calls_of(
        np.array([[0.9, 0.05, 0.03, 0.02], [0.5, 0.45, 0.03, 0.02], [0.35, 0.3, 0.2, 0.15]])
    )
    assert calls.band.tolist() == [0, 2, 3]
    assert calls.close.tolist() == [False, True, True]
    assert calls.unsure.tolist() == [False, True, True]
    assert calls.other.tolist() == [1, 1, 1]


def test_the_expected_mistakes_range_counts_every_cell_by_its_tumor_probability() -> None:
    calls = calls_of(np.array([[0.9, 0.1, 0, 0], [0.6, 0.4, 0, 0], [0.3, 0.7, 0, 0]]))
    point, low, high = share_ranges(calls, np.arange(3))["expected mistakes"]
    assert point == pytest.approx(2 / 3)
    assert low == pytest.approx(1.5 / 3)
    assert high == pytest.approx(2.3 / 3)


def test_a_firm_answer_needs_the_whole_range_on_one_side() -> None:
    assert side(0.31, 0.4, 0.3) == "above"
    assert side(0.1, 0.29, 0.3) == "below"
    assert side(0.25, 0.35, 0.3) == "either"


def test_regions_gather_whole_images_of_one_tissue_until_they_are_big_enough() -> None:
    image = np.repeat(np.arange(5), [200, 150, 100, 400, 50])
    tissue = np.repeat([0, 0, 0, 1, 1], [200, 150, 100, 400, 50])
    regions = patch_regions(image, tissue)
    assert [len(members) for members in regions] == [350, 400]


def test_auroc_ranks_wrong_calls_above_right_ones() -> None:
    wrong = np.array([True, True, False, False])
    assert auroc(np.array([0.9, 0.8, 0.2, 0.1]), wrong) == 1.0
    assert auroc(np.array([0.5, 0.5, 0.5, 0.5]), wrong) == 0.5


@needs_cached_outputs
def test_one_view_reproduces_the_poc_confidence_display_numbers() -> None:
    report = poc_replay(PANNUKE, 1)
    assert report["temperature"] == 1.42
    assert report["regions"] == 32
    ranges = report["ranges"]
    assert ranges["expected mistakes"]["covers_truth"] == pytest.approx(0.65625)
    assert ranges["expected mistakes"]["firm_share"] == pytest.approx(0.875)
    assert ranges["expected mistakes"]["firm_wrong"] == 0
    assert ranges["flips"]["covers_truth"] == pytest.approx(0.40625)
    assert ranges["binomial"]["covers_truth"] == pytest.approx(0.25)
    checking = report["checking"]
    assert checking["tumor contested"][1]["mean_error_pp"] == pytest.approx(2.346399, abs=1e-6)
    assert checking["least sure"][1]["mean_error_pp"] == pytest.approx(2.752191, abs=1e-6)
    assert checking["random"][1]["mean_error_pp"] == pytest.approx(3.117569, abs=1e-6)
    assert report["settle"] == pytest.approx(
        {"open_cases": 16, "settled": 12, "settled_right": 12, "mean_checked_share": 0.18234},
        abs=1e-5,
    )
    displays = report["displays"]
    assert displays["auroc_fade"] == pytest.approx(0.8194, abs=1e-4)
    assert displays["auroc_bands"] == pytest.approx(0.7800, abs=1e-4)
    assert displays["faintest_fifth_catches"] == pytest.approx(0.5363, abs=1e-4)
    assert displays["unsure_flags"] == pytest.approx(0.0755, abs=1e-4)
    assert displays["unsure_catches"] == pytest.approx(0.2312, abs=1e-4)
    wording = report["wording"]
    assert wording["plain"]["A"]["first_right"] == pytest.approx(0.9497, abs=1e-4)
    assert wording["plain"]["A or B"]["either_right"] == pytest.approx(0.9243, abs=1e-4)
    assert (wording["frequency_cells"], wording["frequency_off_by_2_or_more"]) == (54, 3)
    assert report["warnings"]["fires_on"] == 1
    assert report["track_record"]["kept_after_unsure_review"] == pytest.approx(0.4722, abs=1e-4)


@needs_cached_outputs
def test_eight_views_give_no_wrong_firm_answer_from_the_expected_mistakes_range() -> None:
    report = poc_replay(PANNUKE, 8)
    assert report["temperature"] == 1.29
    assert report["ranges"]["expected mistakes"]["firm_wrong"] == 0
    assert report["settle"]["settled"] == report["settle"]["settled_right"]
