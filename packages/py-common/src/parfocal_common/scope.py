import random
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from parfocal_common.object_ids import Letter


class ScopeKind(StrEnum):
    ALL_REGIONS = "all-regions"
    RANDOM_CELLS = "random-cells"
    CELLS_BELOW_SCORE = "cells-below-score"
    INSIDE_ROIS = "inside-rois"
    UNSURE_ZONES = "unsure-zones"


type ObjectKey = tuple[Letter, int]


@dataclass(frozen=True)
class Candidate:
    letter: Letter
    number: int
    score: int | None = None
    inside_roi: bool = False
    inside_zone: bool = False

    @property
    def key(self) -> ObjectKey:
        return self.letter, self.number


@dataclass(frozen=True)
class Scope:
    kind: ScopeKind
    count: int | None = None
    seed: int | None = None
    score: int | None = None


@dataclass(frozen=True)
class Progress:
    done: int
    total: int


def sample(numbers: Iterable[int], count: int, seed: int, slide_key: str) -> list[int]:
    pool = sorted(set(numbers))
    picker = random.Random(f"{seed}:{slide_key}")
    return sorted(picker.sample(pool, min(count, len(pool))))


def cells_of(candidates: Sequence[Candidate]) -> list[Candidate]:
    return [item for item in candidates if item.letter is Letter.CELL]


def in_scope(scope: Scope, candidates: Sequence[Candidate], slide_key: str) -> list[ObjectKey]:
    match scope.kind:
        case ScopeKind.ALL_REGIONS:
            chosen = [item.key for item in candidates if item.letter is Letter.REGION]
        case ScopeKind.RANDOM_CELLS:
            if scope.count is None or scope.seed is None:
                raise ValueError("A random sample needs a count and a seed")
            numbers = sample(
                (item.number for item in cells_of(candidates)), scope.count, scope.seed, slide_key
            )
            chosen = [(Letter.CELL, number) for number in numbers]
        case ScopeKind.CELLS_BELOW_SCORE:
            if scope.score is None:
                raise ValueError("Cells below a score need the score")
            threshold = scope.score
            chosen = [
                item.key
                for item in cells_of(candidates)
                if item.score is not None and item.score < threshold
            ]
        case ScopeKind.INSIDE_ROIS:
            chosen = [
                item.key
                for item in candidates
                if item.inside_roi and item.letter in {Letter.REGION, Letter.CELL}
            ]
        case ScopeKind.UNSURE_ZONES:
            chosen = [item.key for item in cells_of(candidates) if item.inside_zone]
    return sorted(set(chosen))


def progress(scope_keys: Collection[ObjectKey], judged: Iterable[ObjectKey]) -> Progress:
    wanted = set(scope_keys)
    return Progress(done=len(wanted & set(judged)), total=len(wanted))
