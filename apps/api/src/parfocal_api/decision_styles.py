import uuid
from collections.abc import Sequence
from itertools import pairwise
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from parfocal_api.problems import BadRequestError
from parfocal_api.tables import DEFAULT_COUNTS_AS, DecisionStyle, DecisionValue

ANSWERS: dict[DecisionStyle, frozenset[str]] = {
    DecisionStyle.CERTAINTY: frozenset({"1", "2", "3", "4", "5", "unsure"}),
    DecisionStyle.AGREE: frozenset({"agree", "disagree", "unsure"}),
    DecisionStyle.YES_NO: frozenset({"yes", "no", "unsure"}),
    DecisionStyle.BLIND: frozenset({"class", "unsure"}),
}
RANK = {DecisionValue.DISAGREE: 0, DecisionValue.UNSURE: 1, DecisionValue.AGREE: 2}


def counts_both_ways(mapping: list[DecisionValue]) -> list[DecisionValue]:
    if DecisionValue.AGREE not in mapping or DecisionValue.DISAGREE not in mapping:
        raise ValueError("Counts as needs at least one agree and one disagree answer")
    if any(RANK[low] > RANK[high] for low, high in pairwise(mapping)):
        raise ValueError("Counts as runs from disagree through not sure to agree")
    return mapping


type CountsAs = Annotated[
    list[DecisionValue], Field(min_length=5, max_length=5), AfterValidator(counts_both_ways)
]
type DecisionQuestion = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)
]


class DecisionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    style: DecisionStyle = DecisionStyle.CERTAINTY
    counts_as: CountsAs = [DecisionValue(value) for value in DEFAULT_COUNTS_AS]
    question: DecisionQuestion | None = None


class AnswerNotInStyleError(BadRequestError):
    code = "answer-not-in-style"
    title = "This answer is not one of the task's decision style"


def answer_in_style(style: DecisionStyle, answer: str, class_id: uuid.UUID | None) -> None:
    if answer not in ANSWERS[style]:
        allowed = ", ".join(sorted(ANSWERS[style]))
        raise AnswerNotInStyleError(f"A {style} task takes {allowed}, not {answer}")
    if (answer == "class") != (class_id is not None):
        raise AnswerNotInStyleError("Name the class picked, and only with the class answer")


def counted(
    style: DecisionStyle,
    answer: str,
    counts_as: Sequence[str],
    picked: uuid.UUID | None = None,
    ai_class: uuid.UUID | None = None,
) -> DecisionValue:
    if answer == "unsure":
        return DecisionValue.UNSURE
    match style:
        case DecisionStyle.CERTAINTY:
            return DecisionValue(counts_as[int(answer) - 1])
        case DecisionStyle.AGREE:
            return DecisionValue(answer)
        case DecisionStyle.YES_NO:
            return DecisionValue.AGREE if answer == "yes" else DecisionValue.DISAGREE
        case DecisionStyle.BLIND:
            same = ai_class is not None and picked == ai_class
            return DecisionValue.AGREE if same else DecisionValue.DISAGREE
