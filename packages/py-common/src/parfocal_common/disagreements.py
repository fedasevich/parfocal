from collections.abc import Mapping
from enum import StrEnum

AGREE = "agree"
DISAGREE = "disagree"


class Why(StrEnum):
    REVIEWERS_DIFFER = "reviewers-differ"
    AGAINST_THE_AI = "against-the-ai"


def why_queued(values: Mapping[object, str]) -> Why | None:
    judged = list(values.values())
    if not judged:
        return None
    if len(set(judged)) > 1:
        return Why.REVIEWERS_DIFFER
    if judged.count(DISAGREE) * 2 > len(judged):
        return Why.AGAINST_THE_AI
    return None
