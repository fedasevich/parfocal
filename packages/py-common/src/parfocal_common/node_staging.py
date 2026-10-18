from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

MACRO_MM = 2.0
MICRO_MM = 0.2
CELL_LIMIT = 200
AI_SIZE_ERROR = 0.10


class Call(StrEnum):
    TUMOR = "tumor"
    NOT_TUMOR = "not-tumor"
    UNSURE = "unsure"


class Category(StrEnum):
    NONE = "none"
    ITC = "itc"
    MICRO = "micro"
    MACRO = "macro"


class State(StrEnum):
    OPEN = "open"
    SO_FAR = "so-far"
    SETTLED = "settled"


RANK = list(Category)

STAGES = {
    Category.NONE: "pN0(sn)",
    Category.ITC: "pN0(i+)(sn)",
    Category.MICRO: "pN1mi(sn)",
    Category.MACRO: "pN1a(sn)",
}


@dataclass(frozen=True)
class Cell:
    tumor_probability: float
    called_tumor: bool
    checked: bool | None = None


@dataclass(frozen=True)
class Area:
    id: str
    ai_size_mm: float
    call: Call | None = None
    measured_mm: float | None = None
    cells: Sequence[Cell] | None = None


@dataclass(frozen=True)
class Range:
    low: float
    value: float
    high: float


@dataclass(frozen=True)
class AreaStage:
    id: str
    size: Range
    count: Range | None
    highest: Category
    can_change_category: bool


@dataclass(frozen=True)
class NodeStage:
    lead: str | None
    size: Range | None
    count: Range | None
    category: Category
    needs_count: bool
    stage: str
    state: State
    areas: list[AreaStage]


def size_of(area: Area) -> Range:
    if area.measured_mm is not None:
        return Range(area.measured_mm, area.measured_mm, area.measured_mm)
    return Range(
        area.ai_size_mm * (1 - AI_SIZE_ERROR),
        area.ai_size_mm,
        area.ai_size_mm * (1 + AI_SIZE_ERROR),
    )


def count_of(cells: Sequence[Cell]) -> Range:
    confirmed = sum(cell.checked is True for cell in cells)
    open_cells = [cell for cell in cells if cell.checked is None]
    called = [cell for cell in open_cells if cell.called_tumor]
    others = [cell for cell in open_cells if not cell.called_tumor]
    return Range(
        confirmed + sum(cell.tumor_probability for cell in called),
        confirmed + len(called),
        confirmed + len(called) + sum(cell.tumor_probability for cell in others),
    )


def category_of(size_mm: float, tumor_cells: float | None = None) -> Category:
    if size_mm > MACRO_MM:
        return Category.MACRO
    if size_mm > MICRO_MM or (tumor_cells is not None and tumor_cells > CELL_LIMIT):
        return Category.MICRO
    return Category.ITC


def count_is_firm(count: Range) -> bool:
    return count.high <= CELL_LIMIT or count.low > CELL_LIMIT


def describe(area: Area) -> tuple[Range, Range | None, Category]:
    size = size_of(area)
    count = count_of(area.cells) if area.cells is not None else None
    highest = category_of(size.high, count.high if count is not None else None)
    return size, count, highest


def stage_node(areas: Sequence[Area]) -> NodeStage:
    described = {area.id: describe(area) for area in areas}
    candidates = [area for area in areas if area.call is not Call.NOT_TUMOR]
    if not candidates:
        return NodeStage(
            lead=None,
            size=None,
            count=None,
            category=Category.NONE,
            needs_count=False,
            stage=STAGES[Category.NONE],
            state=State.SETTLED if areas else State.SO_FAR,
            areas=[
                AreaStage(area.id, *described[area.id], can_change_category=False) for area in areas
            ],
        )
    lead = max(candidates, key=lambda area: described[area.id][0].value)
    size, count, _ = described[lead.id]
    needs_count = size.value <= MICRO_MM
    category = category_of(size.value, count.value if needs_count and count else None)
    others = {
        area.id: RANK.index(described[area.id][2]) > RANK.index(category)
        for area in candidates
        if area.id != lead.id
    }
    settled = (
        lead.call is Call.TUMOR
        and lead.measured_mm is not None
        and (not needs_count or (count is not None and count_is_firm(count)))
        and not any(others.values())
    )
    state = State.SETTLED if settled else State.SO_FAR if lead.call is Call.TUMOR else State.OPEN
    return NodeStage(
        lead=lead.id,
        size=size,
        count=count if needs_count else None,
        category=category,
        needs_count=needs_count,
        stage=STAGES[category],
        state=state,
        areas=[
            AreaStage(area.id, *described[area.id], can_change_category=others.get(area.id, False))
            for area in areas
        ],
    )
