import json
import random
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.object_ids import Letter, parse
from parfocal_common.review_order import Rated, certainty_of, least_sure_first
from parfocal_common.scope import ObjectKey

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "review-order.json").read_text())
SETS: dict[str, dict[str, Any]] = FIXTURE["sets"]
SEED: int = FIXTURE["seed"]
SLIDE: str = FIXTURE["slide_key"]


def key(text: str) -> ObjectKey:
    found = parse(text)
    return found.letter, found.number


def certainty(item: dict[str, Any]) -> int | None:
    return certainty_of(item["class"], item["score"], item["probabilities"])


def rated(name: str) -> list[Rated]:
    return [Rated(key(item["id"]), certainty(item)) for item in SETS[name]["objects"]]


def ordered(name: str, seed: int = SEED, slide_key: str = SLIDE) -> list[ObjectKey]:
    return least_sure_first(rated(name), seed, slide_key)


@pytest.mark.parametrize("name", list(SETS))
def test_certainty_is_the_class_probability_else_the_score(name: str) -> None:
    found = {item["id"]: certainty(item) for item in SETS[name]["objects"]}
    assert found == SETS[name]["certainty"]


@pytest.mark.parametrize("name", list(SETS))
def test_scored_objects_come_least_sure_first_and_unscored_ones_after(name: str) -> None:
    expected = SETS[name]
    order = ordered(name)
    scored = [key(text) for text in expected["scored"]]
    assert order[: len(scored)] == scored
    assert sorted(order[len(scored) :]) == sorted(key(text) for text in expected["unscored"])


def test_ties_break_by_object_id_with_cells_before_regions() -> None:
    assert ordered("ties") == [
        (Letter.CELL, 9),
        (Letter.CELL, 2),
        (Letter.CELL, 4),
        (Letter.REGION, 1),
        (Letter.REGION, 2),
    ]


@pytest.mark.parametrize("name", ["no-scores", "mixed"])
def test_the_unscored_order_depends_on_the_seed_and_slide_not_the_input_order(name: str) -> None:
    shuffled = rated(name)
    random.Random(7).shuffle(shuffled)
    first = ordered(name)
    assert first == least_sure_first(shuffled, SEED, SLIDE) == ordered(name)


def test_each_slide_and_seed_gets_its_own_unscored_order() -> None:
    one = ordered("no-scores")
    assert one != ordered("no-scores", slide_key="slide-a2")
    assert one != ordered("no-scores", seed=SEED + 1)
    assert one != sorted(one)


def test_an_empty_slide_has_an_empty_order() -> None:
    assert least_sure_first([], 1, "s") == []
