import pytest

from parfocal_common.disagreements import Why, why_queued


@pytest.mark.parametrize(
    ("values", "why"),
    [
        ({"a": "agree", "b": "agree"}, None),
        ({"a": "unsure", "b": "unsure"}, None),
        ({"a": "agree", "b": "disagree"}, Why.REVIEWERS_DIFFER),
        ({"a": "agree", "b": "unsure"}, Why.REVIEWERS_DIFFER),
        ({"a": "disagree", "b": "disagree", "c": "agree"}, Why.REVIEWERS_DIFFER),
        ({"a": "disagree", "b": "disagree"}, Why.AGAINST_THE_AI),
        ({"a": "disagree"}, Why.AGAINST_THE_AI),
        ({"a": "agree"}, None),
        ({}, None),
    ],
)
def test_an_object_is_queued_when_reviewers_differ_or_most_reject_the_ai(
    values: dict[str, str], why: Why | None
) -> None:
    assert why_queued(values) == why


@pytest.mark.parametrize(
    ("values", "second_look", "why"),
    [
        ({"a": "unsure", "b": "unsure"}, {"a"}, Why.SECOND_LOOK),
        ({"a": "agree", "b": "unsure"}, {"b"}, Why.SECOND_LOOK),
        ({"a": "disagree", "b": "disagree"}, {"c"}, Why.AGAINST_THE_AI),
        ({"a": "agree", "b": "agree"}, set[str](), None),
    ],
)
def test_a_reviewer_asking_for_a_second_look_queues_the_object(
    values: dict[str, str], second_look: set[str], why: Why | None
) -> None:
    assert why_queued(values, second_look) == why
