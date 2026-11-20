from collections.abc import Collection, Mapping
from enum import StrEnum

AGREE = "agree"
DISAGREE = "disagree"
OUTLINE_OVERLAP = 60


class Why(StrEnum):
    REVIEWERS_DIFFER = "reviewers-differ"
    AGAINST_THE_AI = "against-the-ai"
    SECOND_LOOK = "second-look"
    OUTLINES_DIFFER = "outlines-differ"


def why_queued[K](values: Mapping[K, str], second_look: Collection[K] = ()) -> Why | None:
    judged = list(values.values())
    if not judged:
        return None
    if any(key in values for key in second_look):
        return Why.SECOND_LOOK
    if len(set(judged)) > 1:
        return Why.REVIEWERS_DIFFER
    if judged.count(DISAGREE) * 2 > len(judged):
        return Why.AGAINST_THE_AI
    return None
