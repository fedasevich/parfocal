import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from parfocal_api.evaluation_paper import fixed
from parfocal_api.locales import DEFAULT_LOCALE, Locale
from parfocal_api.report_style import FONT_ASCENT, FONT_DESCENT
from parfocal_api.report_template import RenderedReport
from parfocal_common.report_blocks import ReportBlock, ReportFormat
from parfocal_common.report_layout import ReportPage

SHEET_WIDTH_PX = 520
SHEET_LINE_HEIGHT = 1.5
SHEET_TEMPLATE = Path(__file__).parent / "sample_layout.typ"
TEXT_SIZES = {"small": 9, "normal": 11, "large": 13}
PAPER_MM = {"a4": (210, 297), "letter": (216, 279)}
PAPER_PT = {"a4": (595.2756, 841.8898), "letter": (612.0, 792.0)}
FILLS = {"{task}": "RT-14 · Round 2", "{model}": "CAMELYON", "{version}": "v1.0"}
FILLS["{slides}"] = "12 slides"
SAMPLE_NUMBERS = {
    "sensitivity": 0.86,
    "precision": 0.81,
    "dice": 0.77,
    "kappa": 0.72,
    "cell-agreement": 0.83,
}
METRIC_LABELS = {
    "sensitivity": "Sensitivity",
    "precision": "Precision",
    "dice": "Dice",
    "kappa": "Cohen's κ",
    "cell-agreement": "Cells agreed",
}
SLIDES = ("A1", "A2", "B1")
PART_LABELS = {"form": "Opinion form", "cells": "Cells", "regions": "Regions"}
SLIDE_COLUMNS = {"time": "Review time", "objects": "Objects", "disagreements": "Disagreements"}
REASONS = (("Wrong class", 41), ("Wrong outline", 33), ("Not a nucleus", 26))
ANSWERS = (("Yes", 64), ("No", 22), ("Unsure", 14))
EMPTY_PAGE = "An empty page. Drag a block here or click one on the left."
SIGNATURE = "Signed off by: ____________  Date: ________"
NOT_REAL = "Sample · not a real evaluation"


@dataclass(frozen=True)
class Cards:
    cards: tuple[tuple[str, str], ...]
    kind: Literal["cards"] = "cards"


@dataclass(frozen=True)
class SampleTable:
    head: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    kind: Literal["table"] = "table"


@dataclass(frozen=True)
class SampleBars:
    rows: tuple[tuple[str, int], ...]
    kind: Literal["bars"] = "bars"


@dataclass(frozen=True)
class SampleFigure:
    layers: str
    caption: str
    kind: Literal["figure"] = "figure"


@dataclass(frozen=True)
class SampleText:
    body: str
    kind: Literal["text"] = "text"


type SamplePart = Cards | SampleTable | SampleBars | SampleFigure | SampleText


@dataclass(frozen=True)
class SampleBlock:
    title: str | None
    half: bool
    part: SamplePart


@dataclass(frozen=True)
class SampleSheet:
    head: Literal["letterhead", "running", "none"]
    blocks: tuple[SampleBlock, ...]
    footer: str
    numbering: str


@dataclass(frozen=True)
class SamplePaper:
    width_pt: float
    height_pt: float
    text_size: int
    logo: bool
    title: str
    subtitle: str
    watermark: bool
    sheets: tuple[SampleSheet, ...] = field(default_factory=tuple)
    project: str = "Sample project · sample numbers"
    brand: str = "Parfocal"
    empty: str = EMPTY_PAGE


def filled(text: str) -> str:
    for key, value in FILLS.items():
        text = text.replace(key, value)
    return text


def sample_value(metric: str, decimals: int) -> str:
    value = SAMPLE_NUMBERS.get(metric)
    return "" if value is None else fixed(value, decimals)


def less(metric: str, decimals: int, by: float) -> str:
    return fixed(float(sample_value(metric, decimals)) - by, decimals)


def region_rows(columns: list[str], decimals: int) -> tuple[tuple[str, ...], ...]:
    return tuple(
        (slide, *(less(metric, decimals, index * 0.03) for metric in columns))
        for index, slide in enumerate(SLIDES)
    )


def slide_value(column: str, index: int) -> str:
    if column == "time":
        return f"{14 + index} min"
    if column == "objects":
        return str(58 - index * 4)
    return str(9 - index * 2)


def matrix_part(share: bool) -> SampleTable:
    counts = (("412", "37", "19"), ("28", "261", "22"), ("11", "9", "140"))
    shares = (("88%", "8%", "4%"), ("9%", "84%", "7%"), ("6%", "5%", "89%"))
    names = ("Tumor", "Inflammatory", "Other")
    rows = tuple(
        (name, *values) for name, values in zip(names, shares if share else counts, strict=True)
    )
    return SampleTable(("AI said", *names), rows)


def chart(style: str, head: str, rows: tuple[tuple[str, int], ...]) -> SamplePart:
    if style == "table":
        return SampleTable((head, "Share"), tuple((label, f"{share}%") for label, share in rows))
    return SampleBars(rows)


def part_of(block: ReportBlock, decimals: int) -> SamplePart:
    found: dict[str, Any] = block.model_dump(mode="json")
    kind = found["kind"]
    if kind == "headline-numbers":
        return Cards(
            tuple((sample_value(name, decimals), METRIC_LABELS[name]) for name in found["metrics"])
        )
    if kind == "region-metrics":
        columns = found["columns"]
        head = ("Slide", *(METRIC_LABELS[name] for name in columns))
        return SampleTable(head, region_rows(columns, decimals))
    if kind == "confusion-matrix":
        return matrix_part(found["values"] == "share")
    if kind == "reviewer-agreement":
        kappa = sample_value("kappa", decimals)
        rows = tuple((PART_LABELS[part], kappa) for part in found["parts"])
        return SampleTable(("Agreement on", "Cohen's κ"), rows)
    if kind == "disagreement-reasons":
        return chart(found["style"], "Reason", REASONS)
    if kind == "opinion-answers":
        return chart(found["style"], "Answer", ANSWERS)
    if kind == "worst-objects":
        rows = (("T2·C145", "3 of 3"), ("T1·R12", "3 of 3"), ("T4·C88", "2 of 3"))
        return SampleTable(("Object", "Disagreed"), rows)
    if kind == "slide-table":
        columns = found["columns"]
        rows = tuple(
            (slide, *(slide_value(column, index) for column in columns))
            for index, slide in enumerate(SLIDES)
        )
        return SampleTable(("Slide", *(SLIDE_COLUMNS[name] for name in columns)), rows)
    if kind == "slide-figure":
        layers = " + ".join(
            "AI result" if layer == "ai" else "Reviewed layer" for layer in found["layers"]
        )
        return SampleFigure(layers, filled(found["caption"]))
    if kind == "text":
        return SampleText(filled(found["body"]) if found["body"] else "Your text appears here.")
    if kind == "comparison":
        rows = tuple(
            (METRIC_LABELS[name], sample_value(name, decimals), less(name, decimals, 0.04))
            for name in found["metrics"]
        )
        return SampleTable(("Metric", "RT-14", "RT-15"), rows)
    group = "Slide" if found["group_by"] == "slide" else "Class"
    rows = (("Tumor", "331", "52", "29"), ("Inflammatory", "204", "31", "26"))
    return SampleTable((group, "Kept", "Edited", "Deleted"), rows)


def paginate(blocks: list[ReportBlock]) -> list[list[ReportBlock]]:
    pages: list[list[ReportBlock]] = [[]]
    for index, block in enumerate(blocks):
        if block.page_break and index > 0:
            pages.append([])
        pages[-1].append(block)
    return pages


def numbering(report_format: ReportFormat, at: int, count: int) -> str:
    if report_format.page_numbers == "none":
        return ""
    if report_format.page_numbers == "page":
        return str(at + 1)
    return f"Page {at + 1} of {count}"


def head_of(report_format: ReportFormat, at: int) -> Literal["letterhead", "running", "none"]:
    if at == 0:
        return "letterhead"
    return "running" if report_format.running_header else "none"


def sample_paper(blocks: list[ReportBlock], report_format: ReportFormat) -> SamplePaper:
    pages = paginate(blocks)
    width, height = PAPER_PT[report_format.paper]
    if report_format.orientation == "landscape":
        width, height = height, width
    last = len(pages) - 1
    sheets = tuple(
        SampleSheet(
            head=head_of(report_format, at),
            blocks=tuple(
                SampleBlock(
                    block.title if block.show_title else None,
                    block.width == "half",
                    part_of(block, report_format.decimals),
                )
                for block in page
            ),
            footer=SIGNATURE if at == last and report_format.signature else NOT_REAL,
            numbering=numbering(report_format, at, len(pages)),
        )
        for at, page in enumerate(pages)
    )
    return SamplePaper(
        width_pt=width,
        height_pt=height,
        text_size=TEXT_SIZES[report_format.text_size],
        logo=report_format.logo,
        title=filled(report_format.title),
        subtitle=filled(report_format.subtitle),
        watermark=report_format.draft_watermark,
        sheets=sheets,
    )


def part_texts(part: SamplePart) -> list[str]:
    match part:
        case Cards():
            return [text for card in part.cards for text in card]
        case SampleTable():
            return [*part.head, *(cell for row in part.rows for cell in row)]
        case SampleBars():
            return [text for label, share in part.rows for text in (label, f"{share}%")]
        case SampleFigure():
            return [part.layers, *([part.caption] if part.caption else [])]
        case SampleText():
            return [part.body]


def sample_texts(paper: SamplePaper) -> list[list[str]]:
    pages: list[list[str]] = []
    for sheet in paper.sheets:
        texts: list[str] = []
        if sheet.head == "letterhead":
            texts += [*([paper.brand] if paper.logo else []), paper.project]
            texts += [paper.title, paper.subtitle]
        elif sheet.head == "running":
            texts += [paper.title, paper.subtitle]
        for block in sheet.blocks:
            texts += [*([block.title] if block.title else []), *part_texts(block.part)]
        if not sheet.blocks:
            texts.append(paper.empty)
        texts += [sheet.footer, *([sheet.numbering] if sheet.numbering else [])]
        pages.append([text for text in texts if text])
    return pages


def sheet_px(paper: SamplePaper) -> float:
    return round(paper.width_pt / SHEET_WIDTH_PX, 6)


def sample_layout(paper: SamplePaper) -> str:
    half_leading = (SHEET_LINE_HEIGHT - FONT_ASCENT - FONT_DESCENT) / 2
    height_px = round(SHEET_WIDTH_PX * paper.height_pt / paper.width_pt, 3)
    return (
        SHEET_TEMPLATE.read_text()
        .replace("SHEET_PX", str(sheet_px(paper)))
        .replace("SHEET_TOP_EDGE", str(round(half_leading + FONT_ASCENT, 4)))
        .replace("SHEET_BOTTOM_EDGE", str(round(half_leading + FONT_DESCENT, 4)))
        .replace("SHEET_WIDTH", str(SHEET_WIDTH_PX))
        .replace("SHEET_HEIGHT", str(height_px))
    )


def sample_report(
    blocks: list[ReportBlock], report_format: ReportFormat, locale: Locale = DEFAULT_LOCALE
) -> RenderedReport:
    paper = sample_paper(blocks, report_format)
    return RenderedReport(
        locale=locale,
        source=sample_layout(paper),
        inputs={"paper": json.dumps(asdict(paper), ensure_ascii=False)},
        pages=tuple(ReportPage() for _ in paper.sheets),
        format=report_format,
    )
