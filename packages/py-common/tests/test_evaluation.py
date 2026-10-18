import json
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.evaluation import (
    Added,
    AiObject,
    Areas,
    Consensus,
    Opinion,
    Ratio,
    Verdict,
    cell_agreement,
    confusion,
    consensus,
    fleiss,
    mean_dice,
    overall,
    pairwise_kappa,
    reasons,
    summarise,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "evaluation-task.json").read_text())
EXPECTED = FIXTURE["expected"]


def verdict(given: list[str]) -> Verdict:
    return Verdict(given[0], *given[1:])


def objects() -> list[AiObject]:
    return [
        AiObject(
            item["slide"],
            item["kind"],
            item["number"],
            item["class"],
            {"a": verdict(item["a"]), "b": verdict(item["b"])},
            item.get("decision"),
        )
        for item in FIXTURE["objects"]
    ]


def added() -> list[Added]:
    return [Added(item["slide"], item["kind"], item["class"]) for item in FIXTURE["added"]]


@pytest.mark.parametrize(
    ("kind", "class_name"), [("region", "tumor"), ("cell", "tumor"), ("cell", "lymphocyte")]
)
def test_precision_and_sensitivity_match_the_hand_counts(kind: str, class_name: str) -> None:
    expected: dict[str, Any] = EXPECTED[f"{kind}s"][class_name]
    counts = confusion(objects(), added())[(kind, class_name)]
    assert (
        counts.true_positives,
        counts.false_positives,
        counts.false_negatives,
        counts.unsure,
        counts.undecided,
    ) == (expected["tp"], expected["fp"], expected["fn"], expected["unsure"], expected["undecided"])
    precision, sensitivity = counts.precision, counts.sensitivity
    assert (precision.numerator, precision.denominator) == tuple(expected["precision"])
    assert (sensitivity.numerator, sensitivity.denominator) == tuple(expected["sensitivity"])
    assert precision.value == pytest.approx(expected["precision"][0] / expected["precision"][1])


def test_the_overall_cell_counts_add_up_the_classes() -> None:
    total = overall(confusion(objects(), added()), "cell")
    assert (total.true_positives, total.false_positives, total.false_negatives) == (3, 2, 1)
    assert total.precision == Ratio(0.6, 3, 5)


def test_the_consensus_follows_unanimity_then_the_decision() -> None:
    by_number = {(item.kind, item.number): consensus(item) for item in objects()}
    assert by_number[("region", 4)] is Consensus.AGREE
    assert by_number[("region", 5)] is Consensus.DISAGREE
    assert by_number[("region", 6)] is Consensus.UNSURE
    assert by_number[("cell", 4)] is Consensus.UNDECIDED


def test_kappa_between_the_two_reviewers_matches_the_hand_value() -> None:
    (pair,) = pairwise_kappa(objects())
    numerator, denominator, shared = EXPECTED["kappa"]
    assert (pair.first, pair.second, pair.objects) == ("a", "b", shared)
    assert pair.value == pytest.approx(numerator / denominator)


def test_fleiss_kappa_reproduces_the_textbook_example() -> None:
    table = [
        [0, 0, 0, 0, 14],
        [0, 2, 6, 4, 2],
        [0, 0, 3, 5, 6],
        [0, 3, 9, 2, 0],
        [2, 2, 8, 1, 1],
        [7, 7, 0, 0, 0],
        [3, 2, 6, 3, 0],
        [2, 5, 3, 2, 2],
        [6, 5, 2, 1, 0],
        [0, 2, 2, 3, 7],
    ]
    ratings = [{str(index): n for index, n in enumerate(row)} for row in table]
    assert fleiss(ratings) == pytest.approx(0.20993, abs=1e-5)
    assert fleiss([]) is None


def test_dice_is_the_mean_over_slides_per_class() -> None:
    areas = [
        Areas(item["slide"], item["class"], item["ai"], item["consensus"], item["overlap"])
        for item in FIXTURE["areas"]
    ]
    value, slides = EXPECTED["dice"]["tumor"]
    found = mean_dice(areas)["tumor"]
    assert (found.value, found.denominator) == (pytest.approx(value), slides)
    assert mean_dice([Areas("s", "x", 0, 0, 0)]) == {}


def test_cell_agreement_and_reasons_match_the_hand_counts() -> None:
    with_ai, between = cell_agreement(objects())
    assert [[with_ai.numerator, with_ai.denominator], [between.numerator, between.denominator]] == (
        EXPECTED["cell_agreement"]
    )
    assert [list(pair) for pair in reasons(objects())] == EXPECTED["reasons"]


def test_opinions_are_summarised_by_kind() -> None:
    summaries = {
        item["key"]: summarise(Opinion(item["key"], item["kind"], item["answers"]))
        for item in FIXTURE["opinions"]
    }
    assert (summaries["acceptable"].mean, summaries["acceptable"].spread) == (3.0, 1.0)
    assert summaries["main_error"].counts == {"Boundaries": 2}
    assert summaries["sign_as_is"].counts == {"yes": 1, "no": 1}
    assert (summaries["comment"].count, list(summaries["comment"].texts)) == (
        1,
        ["Edges are loose"],
    )


def test_empty_denominators_are_not_available() -> None:
    empty = confusion([], [])
    assert empty == {}
    assert overall(empty, "region").precision == Ratio(None, 0, 0)
