import random
import uuid

import pytest
from test_training_examples import learned

from parfocal_api.training_examples import TrainingExample
from parfocal_api.validation_split import (
    HELD_OUT_SHARE,
    is_held_out,
    slide_bucket,
    split_examples,
)

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
PROJECT = uuid.UUID("00000000-0000-4000-8000-000000000003")
TASK = uuid.UUID("00000000-0000-4000-8000-000000000004")
GOLDEN_BUCKET = 8601891487095597039


def slide(index: int) -> uuid.UUID:
    return uuid.UUID(int=index)


def round_of(slides: range, cells: int = 3) -> list[TrainingExample]:
    return [
        learned(
            tenant_id=TENANT, project_id=PROJECT, task_id=TASK, slide_id=slide(index), number=number
        )
        for index in slides
        for number in range(cells)
    ]


def test_every_example_lands_on_exactly_one_side() -> None:
    examples = round_of(range(200))
    split = split_examples(examples)
    assert not set(split.training) & set(split.validation)
    assert sorted(map(id, split.training + split.validation)) == sorted(map(id, examples))


def test_cells_of_one_slide_never_straddle_the_split() -> None:
    split = split_examples(round_of(range(200)))
    assert split.validation
    assert not {e.slide_id for e in split.training} & {e.slide_id for e in split.validation}


def test_a_later_round_keeps_every_earlier_example_on_its_side() -> None:
    first = split_examples(round_of(range(150)))
    later = split_examples(round_of(range(300)))
    assert set(first.training) <= set(later.training)
    assert set(first.validation) <= set(later.validation)


def test_new_labels_on_a_known_slide_follow_that_slide() -> None:
    first = split_examples(round_of(range(100), cells=2))
    later = split_examples(round_of(range(100), cells=5))
    assert {e.slide_id for e in first.validation} == {e.slide_id for e in later.validation}


def test_order_of_examples_does_not_change_membership() -> None:
    examples = round_of(range(200))
    shuffled = list(examples)
    random.Random(7).shuffle(shuffled)
    assert set(split_examples(examples).validation) == set(split_examples(shuffled).validation)


def test_the_bucket_of_a_fixed_slide_never_moves() -> None:
    assert slide_bucket(TENANT, slide(1)) == slide_bucket(TENANT, uuid.UUID(int=1))
    assert slide_bucket(TENANT, slide(1)) == GOLDEN_BUCKET


def test_the_same_slide_id_under_another_tenant_is_bucketed_apart() -> None:
    other = uuid.UUID("00000000-0000-4000-8000-000000000002")
    assert slide_bucket(TENANT, slide(1)) != slide_bucket(other, slide(1))


def test_the_held_out_share_is_close_to_the_target() -> None:
    held = sum(is_held_out(TENANT, slide(index)) for index in range(2000))
    assert abs(held / 2000 - HELD_OUT_SHARE) < 0.04


def test_shares_at_the_ends_hold_out_nothing_or_everything() -> None:
    examples = round_of(range(20))
    assert split_examples(examples, share=0.0).validation == ()
    assert split_examples(examples, share=1.0).training == ()
    with pytest.raises(ValueError, match="share"):
        split_examples(examples, share=1.5)


def test_no_labels_give_two_empty_sides() -> None:
    split = split_examples([])
    assert split.training == ()
    assert split.validation == ()
