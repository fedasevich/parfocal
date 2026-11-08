import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

PAGE_UNITS: Mapping[tuple[str, str], int] = {
    ("a4", "portrait"): 24,
    ("a4", "landscape"): 16,
    ("letter", "portrait"): 23,
    ("letter", "landscape"): 17,
}
TEXT_SCALE: Mapping[str, float] = {"small": 1.25, "normal": 1.0, "large": 0.8}
BLOCK_UNITS: Mapping[str, int] = {
    "headline-numbers": 4,
    "region-metrics": 5,
    "confusion-matrix": 6,
    "reviewer-agreement": 4,
    "disagreement-reasons": 4,
    "opinion-answers": 4,
    "worst-objects": 7,
    "slide-table": 5,
    "slide-figure": 7,
    "text": 3,
    "comparison": 4,
    "ai-changes": 5,
}
FIRST_PAGE_UNITS = 5
CLOSING_UNITS = 5


class Placeable(Protocol):
    @property
    def kind(self) -> str: ...

    @property
    def width(self) -> Literal["full", "half"]: ...

    @property
    def page_break(self) -> bool: ...


class Paged(Protocol):
    @property
    def paper(self) -> str: ...

    @property
    def orientation(self) -> str: ...

    @property
    def text_size(self) -> str: ...

    @property
    def appendices(self) -> Sequence[str]: ...


@dataclass(frozen=True)
class ReportPage:
    rows: tuple[tuple[int, ...], ...] = ()
    closing: bool = False
    appendix: str | None = None

    def blocks(self) -> tuple[int, ...]:
        return tuple(index for row in self.rows for index in row)

    def as_json(self) -> dict[str, Any]:
        return {
            "rows": [list(row) for row in self.rows],
            "closing": self.closing,
            "appendix": self.appendix,
        }


@dataclass
class Filling:
    capacity: int
    pages: list[ReportPage] = field(default_factory=list[ReportPage])
    rows: list[tuple[int, ...]] = field(default_factory=list[tuple[int, ...]])
    used: int = FIRST_PAGE_UNITS

    def turn(self, closing: bool = False) -> None:
        self.pages.append(ReportPage(rows=tuple(self.rows), closing=closing))
        self.rows = []
        self.used = 0

    def place(self, height: int, fresh_page: bool) -> None:
        if self.rows and (fresh_page or self.used + height > self.capacity):
            self.turn()


def capacity_of(paged: Paged) -> int:
    return math.floor(PAGE_UNITS[(paged.paper, paged.orientation)] * TEXT_SCALE[paged.text_size])


def report_pages(blocks: Sequence[Placeable], paged: Paged) -> list[ReportPage]:
    filling = Filling(capacity=capacity_of(paged))
    at = 0
    while at < len(blocks):
        block = blocks[at]
        row = (at,)
        following = blocks[at + 1] if at + 1 < len(blocks) else None
        if (
            block.width == "half"
            and following is not None
            and following.width == "half"
            and not following.page_break
        ):
            row = (at, at + 1)
        height = max(BLOCK_UNITS[blocks[index].kind] for index in row)
        filling.place(height, block.page_break)
        filling.rows.append(row)
        filling.used += height
        at += len(row)
    filling.place(CLOSING_UNITS, False)
    filling.turn(closing=True)
    return [*filling.pages, *(ReportPage(appendix=name) for name in paged.appendices)]
