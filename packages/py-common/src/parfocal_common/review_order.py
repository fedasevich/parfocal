import math
import random
import struct
from array import array
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from parfocal_common.cell_chunks import decode
from parfocal_common.object_ids import Letter
from parfocal_common.scope import Candidate, ObjectKey, Scope, in_scope, sample

UNCLASSIFIED = 255
NO_CERTAINTY = -1
UNCALIBRATED = 1.0
PROBABILITY_FLOOR = 1e-7
BYTE = 255
PACKED = struct.Struct("<cI")


@dataclass(frozen=True)
class Rated:
    key: ObjectKey
    certainty: int | None


def calibrated(probabilities: Sequence[int], class_index: int, temperature: float) -> int:
    if temperature == UNCALIBRATED:
        return probabilities[class_index]
    logits = [
        math.log(max(value / BYTE, PROBABILITY_FLOOR)) / temperature for value in probabilities
    ]
    top = max(logits)
    weights = [math.exp(value - top) for value in logits]
    return round(BYTE * weights[class_index] / sum(weights))


def certainty_of(
    class_index: int | None,
    score: int | None,
    probabilities: Sequence[int] | None,
    temperature: float = UNCALIBRATED,
) -> int | None:
    if probabilities and class_index is not None and 0 <= class_index < len(probabilities):
        return calibrated(probabilities, class_index, temperature)
    return score


def least_sure_first(objects: Iterable[Rated], seed: int, slide_key: str) -> list[ObjectKey]:
    certainty = {item.key: item.certainty for item in objects}
    scored = sorted((value, key) for key, value in certainty.items() if value is not None)
    unscored = sorted(key for key, value in certainty.items() if value is None)
    random.Random(f"{seed}:{slide_key}").shuffle(unscored)
    return [key for _, key in scored] + unscored


def pack(keys: Iterable[ObjectKey]) -> bytes:
    return b"".join(PACKED.pack(letter.value.encode(), number) for letter, number in keys)


def unpack(data: bytes) -> list[ObjectKey]:
    return [(Letter(letter.decode()), number) for letter, number in PACKED.iter_unpack(data)]


@dataclass(frozen=True)
class CellChunk:
    numbers: memoryview
    classes: memoryview
    scores: memoryview
    offsets: memoryview
    points: memoryview
    probs: memoryview | None
    class_count: int

    @classmethod
    def read(cls, data: bytes) -> CellChunk:
        return cls.of(*decode(data))

    @classmethod
    def of(cls, header: Mapping[str, Any], arrays: Mapping[str, memoryview]) -> CellChunk:
        return cls(
            numbers=arrays["number"],
            classes=arrays["class"],
            scores=arrays["score"],
            offsets=arrays["offsets"],
            points=arrays["points"],
            probs=arrays.get("probs"),
            class_count=int(header.get("classes") or 0),
        )

    def __len__(self) -> int:
        return len(self.numbers)

    def certainty(self, index: int, temperature: float = UNCALIBRATED) -> int | None:
        ai_class = self.classes[index]
        if self.probs is None or ai_class == UNCLASSIFIED or ai_class >= self.class_count:
            return None
        start = index * self.class_count
        if temperature == UNCALIBRATED:
            return self.probs[start + ai_class]
        return calibrated(self.probs[start : start + self.class_count], ai_class, temperature)

    def centre(self, index: int) -> tuple[float, float] | None:
        start, end = 2 * self.offsets[index], 2 * self.offsets[index + 1]
        if end <= start:
            return None
        xs, ys = self.points[start:end:2], self.points[start + 1 : end : 2]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    def candidates(
        self, inside_roi: Collection[int] = (), inside_zone: Collection[int] = ()
    ) -> list[Candidate]:
        return [
            Candidate(
                Letter.CELL,
                number,
                score=self.scores[index],
                inside_roi=number in inside_roi,
                inside_zone=number in inside_zone,
            )
            for index, number in enumerate(self.numbers)
        ]

    def rated(self, keys: Iterable[ObjectKey], temperature: float = UNCALIBRATED) -> list[Rated]:
        wanted = {number for letter, number in keys if letter is Letter.CELL}
        return [
            Rated((Letter.CELL, number), self.certainty(index, temperature))
            for index, number in enumerate(self.numbers)
            if number in wanted
        ]


def scoped_cells(
    scope: Scope,
    chunk: CellChunk,
    slide_key: str,
    inside_roi: Collection[int] = (),
    inside_zone: Collection[int] = (),
    temperature: float = UNCALIBRATED,
) -> list[Rated]:
    return chunk.rated(
        in_scope(scope, chunk.candidates(inside_roi, inside_zone), slide_key), temperature
    )


@dataclass
class CellPool:
    numbers: array[int] = field(default_factory=lambda: array("I"))
    certainty: array[int] = field(default_factory=lambda: array("h"))

    def add(self, chunk: CellChunk, temperature: float = UNCALIBRATED) -> None:
        self.numbers.extend(chunk.numbers)
        for index in range(len(chunk)):
            value = chunk.certainty(index, temperature)
            self.certainty.append(NO_CERTAINTY if value is None else value)

    def sample(self, count: int, seed: int, slide_key: str) -> list[Rated]:
        chosen = set(sample(self.numbers, count, seed, slide_key))
        return [
            Rated((Letter.CELL, number), None if value == NO_CERTAINTY else value)
            for number, value in zip(self.numbers, self.certainty, strict=True)
            if number in chosen
        ]
