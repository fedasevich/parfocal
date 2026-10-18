import statistics
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from itertools import combinations

AGREE = "agree"
DISAGREE = "disagree"
UNSURE = "unsure"
WRONG_CLASS = "wrong_class"
KEEP_AI = "keep-ai"
GO_WITH_REVIEWERS = "go-with-reviewers"
CATEGORIES = (AGREE, DISAGREE, UNSURE)


class Consensus(StrEnum):
    AGREE = "agree"
    DISAGREE = "disagree"
    UNSURE = "unsure"
    UNDECIDED = "undecided"


@dataclass(frozen=True)
class Verdict:
    value: str
    reason: str | None = None
    reason_class: str | None = None


@dataclass(frozen=True)
class AiObject:
    slide: str
    kind: str
    number: int
    class_name: str
    verdicts: Mapping[str, Verdict]
    decision: str | None = None


@dataclass(frozen=True)
class Added:
    slide: str
    kind: str
    class_name: str


@dataclass(frozen=True)
class Areas:
    slide: str
    class_name: str
    ai: float
    consensus: float
    overlap: float


@dataclass(frozen=True)
class Ratio:
    value: float | None
    numerator: int
    denominator: int


@dataclass
class Counts:
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    unsure: int = 0
    undecided: int = 0

    @property
    def precision(self) -> Ratio:
        return ratio(self.true_positives, self.true_positives + self.false_positives)

    @property
    def sensitivity(self) -> Ratio:
        return ratio(self.true_positives, self.true_positives + self.false_negatives)


@dataclass(frozen=True)
class Kappa:
    first: str
    second: str
    value: float | None
    objects: int


@dataclass(frozen=True)
class Opinion:
    key: str
    kind: str
    answers: Sequence[object]


@dataclass(frozen=True)
class OpinionSummary:
    key: str
    count: int
    mean: float | None = None
    spread: float | None = None
    counts: Mapping[str, int] = field(default_factory=dict[str, int])
    texts: Sequence[str] = ()


def ratio(numerator: int, denominator: int) -> Ratio:
    return Ratio(numerator / denominator if denominator else None, numerator, denominator)


def consensus(item: AiObject) -> Consensus:
    values = {verdict.value for verdict in item.verdicts.values()}
    if not values:
        return Consensus.UNDECIDED
    if len(values) == 1:
        return Consensus(values.pop())
    if item.decision == KEEP_AI:
        return Consensus.AGREE
    if item.decision == GO_WITH_REVIEWERS:
        return Consensus.DISAGREE
    return Consensus.UNDECIDED


def retyped_to(item: AiObject) -> str | None:
    if consensus(item) is not Consensus.DISAGREE:
        return None
    disagreeing = [v for v in item.verdicts.values() if v.value == DISAGREE]
    classes = {v.reason_class for v in disagreeing if v.reason == WRONG_CLASS}
    if disagreeing and len(classes) == 1 and all(v.reason == WRONG_CLASS for v in disagreeing):
        return classes.pop()
    return None


def confusion(objects: Iterable[AiObject], added: Iterable[Added]) -> dict[tuple[str, str], Counts]:
    table: dict[tuple[str, str], Counts] = {}

    def counts(kind: str, class_name: str) -> Counts:
        return table.setdefault((kind, class_name), Counts())

    for item in objects:
        found = consensus(item)
        bucket = counts(item.kind, item.class_name)
        match found:
            case Consensus.AGREE:
                bucket.true_positives += 1
            case Consensus.DISAGREE:
                bucket.false_positives += 1
                if (other := retyped_to(item)) is not None:
                    counts(item.kind, other).false_negatives += 1
            case Consensus.UNSURE:
                bucket.unsure += 1
            case Consensus.UNDECIDED:
                bucket.undecided += 1
    for extra in added:
        counts(extra.kind, extra.class_name).false_negatives += 1
    return table


def overall(table: Mapping[tuple[str, str], Counts], kind: str) -> Counts:
    total = Counts()
    for (bucket_kind, _), counts in table.items():
        if bucket_kind != kind:
            continue
        total.true_positives += counts.true_positives
        total.false_positives += counts.false_positives
        total.false_negatives += counts.false_negatives
        total.unsure += counts.unsure
        total.undecided += counts.undecided
    return total


def dice(areas: Areas) -> float | None:
    both = areas.ai + areas.consensus
    return 2 * areas.overlap / both if both else None


def mean_dice(areas: Iterable[Areas]) -> dict[str, Ratio]:
    by_class: dict[str, list[float]] = {}
    for item in areas:
        value = dice(item)
        if value is not None:
            by_class.setdefault(item.class_name, []).append(value)
    return {
        name: Ratio(statistics.fmean(values), len(values), len(values))
        for name, values in by_class.items()
    }


def cohen(first: Sequence[str], second: Sequence[str]) -> float | None:
    total = len(first)
    if total == 0:
        return None
    observed = sum(a == b for a, b in zip(first, second, strict=True)) / total
    left, right = Counter(first), Counter(second)
    expected = sum(left[c] * right[c] for c in CATEGORIES) / total**2
    return (observed - expected) / (1 - expected) if expected < 1 else None


def pairwise_kappa(objects: Iterable[AiObject]) -> list[Kappa]:
    items = list(objects)
    reviewers = sorted({person for item in items for person in item.verdicts})
    pairs: list[Kappa] = []
    for first, second in combinations(reviewers, 2):
        shared = [item for item in items if first in item.verdicts and second in item.verdicts]
        value = cohen(
            [item.verdicts[first].value for item in shared],
            [item.verdicts[second].value for item in shared],
        )
        pairs.append(Kappa(first, second, value, len(shared)))
    return pairs


def fleiss(ratings: Sequence[Mapping[str, int]]) -> float | None:
    if not ratings:
        return None
    raters = sum(ratings[0].values())
    if raters < 2 or any(sum(row.values()) != raters for row in ratings):
        return None
    subjects = len(ratings)
    categories = sorted({c for row in ratings for c in row})
    shares = [sum(row.get(c, 0) for row in ratings) / (subjects * raters) for c in categories]
    agreement = [
        (sum(n * n for n in row.values()) - raters) / (raters * (raters - 1)) for row in ratings
    ]
    observed = statistics.fmean(agreement)
    expected = sum(share * share for share in shares)
    return (observed - expected) / (1 - expected) if expected < 1 else None


def cell_agreement(objects: Iterable[AiObject]) -> tuple[Ratio, Ratio]:
    cells = [item for item in objects if item.kind == "cell" and item.verdicts]
    decided = [item for item in cells if consensus(item) is not Consensus.UNDECIDED]
    agreeing = sum(consensus(item) is Consensus.AGREE for item in decided)
    unanimous = sum(len({v.value for v in item.verdicts.values()}) == 1 for item in cells)
    return ratio(agreeing, len(decided)), ratio(unanimous, len(cells))


def reasons(objects: Iterable[AiObject]) -> list[tuple[str, int]]:
    counted = Counter(
        verdict.reason
        for item in objects
        for verdict in item.verdicts.values()
        if verdict.value == DISAGREE and verdict.reason
    )
    return sorted(counted.items(), key=lambda pair: (-pair[1], pair[0]))


def summarise(opinion: Opinion) -> OpinionSummary:
    answers = [answer for answer in opinion.answers if answer is not None]
    match opinion.kind:
        case "scale":
            numbers = [float(answer) for answer in answers if isinstance(answer, int | float)]
            return OpinionSummary(
                opinion.key,
                len(numbers),
                mean=statistics.fmean(numbers) if numbers else None,
                spread=statistics.pstdev(numbers) if numbers else None,
            )
        case "yesno":
            return OpinionSummary(
                opinion.key,
                len(answers),
                counts=dict(Counter("yes" if answer else "no" for answer in answers)),
            )
        case "choice":
            return OpinionSummary(
                opinion.key, len(answers), counts=dict(Counter(map(str, answers)))
            )
        case _:
            return OpinionSummary(
                opinion.key, len(answers), texts=[str(answer) for answer in answers]
            )
