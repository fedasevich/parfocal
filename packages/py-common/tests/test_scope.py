import json
import random
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.object_ids import Letter, parse
from parfocal_common.scope import (
    Candidate,
    Progress,
    Scope,
    ScopeKind,
    in_scope,
    progress,
    sample,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "scope-slide.json").read_text())


def candidates(fixture: dict[str, Any]) -> list[Candidate]:
    regions = [
        Candidate(Letter.REGION, item["number"], inside_roi=item["inside_roi"])
        for item in fixture["regions"]
    ]
    cells = [
        Candidate(
            Letter.CELL,
            item["number"],
            score=item["score"],
            inside_roi=item["inside_roi"],
            inside_zone=item["inside_zone"],
        )
        for item in fixture["cells"]
    ]
    return regions + cells


def scope_for(kind: ScopeKind) -> Scope:
    expected = FIXTURE["expected"][kind.value]
    return Scope(
        kind, count=expected.get("count"), seed=expected.get("seed"), score=expected.get("score")
    )


def judged(reviewer: str) -> list[tuple[Letter, int]]:
    return [parse(text).key[:2] for text in FIXTURE["verdicts"][reviewer]]


@pytest.mark.parametrize("kind", list(ScopeKind))
def test_progress_counts_match_the_fixture(kind: ScopeKind) -> None:
    expected = FIXTURE["expected"][kind.value]
    keys = in_scope(scope_for(kind), candidates(FIXTURE), FIXTURE["slide_key"])
    assert len(keys) == expected["total"]
    for reviewer in ("first", "second"):
        assert progress(keys, judged(reviewer)) == Progress(expected[reviewer], expected["total"])


def test_the_random_sample_is_deterministic_and_shared_by_every_reviewer() -> None:
    scope = scope_for(ScopeKind.RANDOM_CELLS)
    expected = [(Letter.CELL, number) for number in FIXTURE["expected"]["random-cells"]["sample"]]
    shuffled = candidates(FIXTURE)
    random.Random(7).shuffle(shuffled)
    first = in_scope(scope, candidates(FIXTURE), FIXTURE["slide_key"])
    second = in_scope(scope, shuffled, FIXTURE["slide_key"])
    assert first == second == expected


def test_each_slide_and_task_gets_its_own_sample() -> None:
    numbers = range(1, 1001)
    one = sample(numbers, 50, seed=42, slide_key="slide-a1")
    assert one == sample(reversed(numbers), 50, seed=42, slide_key="slide-a1")
    assert one != sample(numbers, 50, seed=42, slide_key="slide-a2")
    assert one != sample(numbers, 50, seed=43, slide_key="slide-a1")
    assert len(set(one)) == 50


def test_a_sample_larger_than_the_slide_takes_every_cell() -> None:
    assert sample([5, 3, 1], 10, seed=1, slide_key="s") == [1, 3, 5]
    assert sample([], 10, seed=1, slide_key="s") == []


def test_scopes_without_their_parameters_are_refused() -> None:
    with pytest.raises(ValueError, match="count and a seed"):
        in_scope(Scope(ScopeKind.RANDOM_CELLS, count=5), [], "s")
    with pytest.raises(ValueError, match="the score"):
        in_scope(Scope(ScopeKind.CELLS_BELOW_SCORE), [], "s")


def test_progress_ignores_judgements_outside_the_scope() -> None:
    keys = [(Letter.REGION, 1), (Letter.REGION, 2)]
    outside = [(Letter.REGION, 1), (Letter.CELL, 9), (Letter.REGION, 1)]
    assert progress(keys, outside) == Progress(1, 2)
