from pathlib import Path

import numpy as np
import pytest

from parfocal_common.node_staging import Category
from parfocal_ml.staging_validation import (
    Nuclei,
    checked_until_firm,
    clusters,
    fixture_nuclei,
    judge,
    report,
)

FIXTURE = Path(__file__).parent / "fixtures" / "staging-validation-pannuke.npz"


def nuclei_of(probabilities: list[float], called: list[bool], truth: list[bool]) -> Nuclei:
    size = len(probabilities)
    return Nuclei(
        image=np.zeros(size, dtype=np.int64),
        tissue=np.zeros(size, dtype=np.int64),
        truth=np.array(truth),
        tumor_probability=np.array(probabilities),
        called=np.array(called),
    )


def test_clusters_gather_whole_images_of_one_tissue_until_they_reach_the_size() -> None:
    image = np.repeat(np.arange(5), [200, 150, 100, 400, 50])
    tissue = np.repeat([0, 0, 0, 1, 1], [200, 150, 100, 400, 50])
    assert [len(members) for members in clusters(image, tissue, 300)] == [350, 400]
    assert [len(members) for members in clusters(image, tissue, 500)] == []


def test_a_firm_count_below_the_limit_is_wrong_when_the_true_count_is_over_it() -> None:
    nuclei = nuclei_of([0.99] * 199 + [0.0] * 5, [True] * 199 + [False] * 5, [True] * 204)
    outcome = judge(nuclei, np.arange(204))
    assert outcome.firm
    assert outcome.category is Category.ITC
    assert outcome.true_category is Category.MICRO
    assert outcome.wrong


def test_a_count_whose_range_crosses_the_limit_is_not_firm() -> None:
    nuclei = nuclei_of(
        [0.9] * 210 + [0.3] * 40, [True] * 210 + [False] * 40, [True] * 210 + [False] * 40
    )
    outcome = judge(nuclei, np.arange(250))
    assert (outcome.low, outcome.value) == (pytest.approx(189.0), 210)
    assert not outcome.firm
    assert not outcome.wrong


def test_checking_the_most_contested_cells_settles_an_open_count() -> None:
    nuclei = nuclei_of(
        [0.9] * 210 + [0.3] * 40, [True] * 210 + [False] * 40, [True] * 210 + [False] * 40
    )
    checked, settled, category = checked_until_firm(nuclei, np.arange(250))
    assert settled
    assert category is Category.MICRO
    assert 0 < checked < 250


@pytest.mark.parametrize("views", [1, 8])
def test_the_pannuke_fixture_gives_no_wrong_firm_staging_answer(views: int) -> None:
    found = report(fixture_nuclei(FIXTURE, views))
    assert found["nuclei"] == 12928
    assert found["wrong_firm"] == []
    assert found["all"] == {
        "clusters": 86,
        "true_over_limit": 38,
        "firm": 71,
        "firm_wrong": 0,
        "near": 25,
        "near_firm": 10,
        "near_firm_wrong": 0,
        "covers_truth": 65 if views == 1 else 64,
        "point_wrong_side": 1,
    }
    assert [found["by_size"][size]["firm"] for size in ("300", "400", "500", "600", "800")] == [
        26,
        15,
        12,
        11,
        7,
    ]
    assert found["breast"]["clusters"] == 27
    assert found["breast"]["firm"] == 24
    assert found["checking"]["open"] == 15
    assert found["checking"]["settled_right"] == 15
    assert found["checking"]["checked"] == (978 if views == 1 else 944)
