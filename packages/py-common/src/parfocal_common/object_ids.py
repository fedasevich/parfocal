import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import quote, unquote


class Letter(StrEnum):
    REGION = "T"
    CELL = "C"
    ROI = "R"
    ZONE = "Z"
    MEASUREMENT = "M"


DISPLAY_SEPARATOR = "·"
ASCII_SEPARATOR = "."
DISPLAY_MARK = "⁺"
ASCII_MARK = "+"
LOOSE_CASE = "~"
PATTERN = re.compile(
    r"^(?:T(?P<region>[1-9]\d*)[·.])?"
    r"(?P<letter>[TCRZM])(?P<number>[1-9]\d*)(?P<split>[a-z]*)(?P<mark>[+⁺]?)$",
    re.IGNORECASE,
)


class ObjectIdError(ValueError):
    pass


@dataclass(frozen=True)
class ObjectId:
    letter: Letter
    number: int
    split: str = ""
    person: bool = False
    region: int | None = None

    def __post_init__(self) -> None:
        if self.number < 1:
            raise ObjectIdError("Numbers start at 1")
        if self.split and not (self.split.isalpha() and self.split.islower()):
            raise ObjectIdError("A split suffix is lowercase letters")
        if self.region is not None and (self.letter is not Letter.CELL or self.region < 1):
            raise ObjectIdError("Only a cell is written inside a region")

    def text(self, *, ascii: bool = False) -> str:
        separator = ASCII_SEPARATOR if ascii else DISPLAY_SEPARATOR
        mark = (ASCII_MARK if ascii else DISPLAY_MARK) if self.person else ""
        prefix = f"{Letter.REGION}{self.region}{separator}" if self.region is not None else ""
        return f"{prefix}{self.letter}{self.number}{self.split}{mark}"

    def __str__(self) -> str:
        return self.text()

    @property
    def key(self) -> tuple[Letter, int, str]:
        return self.letter, self.number, self.split


def parse(text: str) -> ObjectId:
    found = PATTERN.match(text.strip())
    if found is None:
        raise ObjectIdError(f"{text!r} is not an object ID")
    region = found["region"]
    return ObjectId(
        letter=Letter(found["letter"].upper()),
        number=int(found["number"]),
        split=found["split"].lower(),
        person=bool(found["mark"]),
        region=int(region) if region else None,
    )


@dataclass(frozen=True)
class ObjectPath:
    project: str
    case: str | None
    slide: str
    object: ObjectId

    def text(self) -> str:
        if self.case == LOOSE_CASE:
            raise ObjectIdError("A case cannot be called ~")
        segments = [
            quote(self.project, safe=""),
            LOOSE_CASE if self.case is None else quote(self.case, safe=""),
            quote(self.slide, safe=""),
            quote(self.object.text(ascii=True), safe=ASCII_MARK),
        ]
        return "/".join(segments)

    def __str__(self) -> str:
        return self.text()


def parse_path(text: str) -> ObjectPath:
    segments = text.strip().split("/")
    if len(segments) != 4 or not all(segments):
        raise ObjectIdError("A path is project/case/slide/object")
    project, case, slide, item = segments
    return ObjectPath(
        project=unquote(project),
        case=None if case == LOOSE_CASE else unquote(case),
        slide=unquote(slide),
        object=parse(unquote(item)),
    )


def by_area(areas: Sequence[float], first: int) -> list[int]:
    order = sorted(range(len(areas)), key=lambda index: (-areas[index], index))
    numbers = [0] * len(areas)
    for offset, index in enumerate(order):
        numbers[index] = first + offset
    return numbers


def in_reading_order(centroids: Sequence[tuple[float, float]], first: int) -> list[int]:
    order = sorted(
        range(len(centroids)), key=lambda index: (centroids[index][1], centroids[index][0], index)
    )
    numbers = [0] * len(centroids)
    for offset, index in enumerate(order):
        numbers[index] = first + offset
    return numbers
