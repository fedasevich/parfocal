import io
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from pydantic import TypeAdapter
from pypdf import PdfReader

from parfocal_api.decision_styles import CountsAsChange, DecisionSettings
from parfocal_api.disagreement_queue import QueueRow
from parfocal_api.evaluation import Evaluation
from parfocal_api.evaluation_exports import Version, paper_report, pdf_of, svg_pages_of
from parfocal_api.evaluation_paper import (
    Clock,
    PaperInputs,
    ReviewStyle,
    counts_as_rule,
    fixed,
    paper_of,
    percent,
    style_of,
    text_of,
)
from parfocal_api.evaluation_report import EvaluationReport
from parfocal_api.evaluation_versions import EvaluationChange
from parfocal_api.locales import DEFAULT_LOCALE
from parfocal_api.report_style import PAPER_PX
from parfocal_common.report_blocks import BLOCKS, ReportFormat

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (ROOT / "packages" / "test-fixtures" / "evaluation-report-screen.json").read_text()
)
CHECKSUM = "sha256:0123456789abcdef"


def inputs_of(fixture: dict[str, Any]) -> PaperInputs:
    raw: dict[str, Any] = fixture["inputs"]
    style: dict[str, Any] = raw["style"]
    return PaperInputs(
        report=EvaluationReport.model_validate(raw["report"]),
        evaluation=Evaluation.model_validate(raw["evaluation"]),
        queue=TypeAdapter(list[QueueRow]).validate_python(raw["queue"]),
        changes=TypeAdapter(list[EvaluationChange]).validate_python(raw["changes"]),
        blocks=tuple(BLOCKS.validate_python(raw["blocks"])),
        format=ReportFormat.model_validate(raw["format"]),
        template_version=int(raw["template_version"]),
        names={str(key): str(value) for key, value in raw["names"].items()},
        style=ReviewStyle(style["kind"], int(style["agree_from"]), int(style["disagree_to"])),
        counts_as_changes=TypeAdapter(list[CountsAsChange]).validate_python(
            raw["counts_as_changes"]
        ),
        checksum=CHECKSUM,
        zone=ZoneInfo(str(fixture["zone"])),
    )


def squeezed(text: str) -> str:
    return re.sub(r"\s+", "", text)


def test_the_paper_model_lists_the_screen_text_sheet_by_sheet() -> None:
    pages = text_of(paper_of(inputs_of(FIXTURE)))
    screen = FIXTURE["screen"]
    assert len(pages) == len(screen)
    for page, shown in zip(pages, screen, strict=True):
        assert squeezed("".join(page)) == squeezed(
            "".join(text for text in shown if text != "The AI said")
        )


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_the_pdf_has_every_screen_text_in_order_and_nothing_else() -> None:
    pytest.importorskip("typst")
    paper = paper_of(inputs_of(FIXTURE))
    version = Version(number=1, checksum=CHECKSUM, signed_at=datetime(2026, 10, 15, tzinfo=UTC))
    report = paper_report(paper, ReportFormat(), DEFAULT_LOCALE)
    reader = PdfReader(io.BytesIO(pdf_of(report, version)))
    assert len(reader.pages) == len(FIXTURE["screen"])
    for page, shown in zip(reader.pages, FIXTURE["screen"], strict=True):
        whole = squeezed(page.extract_text())
        footer = squeezed(f"Checksum {CHECKSUM}")
        assert whole.count(footer) == 1
        left = whole.replace(footer, "", 1).replace("TheAIsaid", "", 1)
        for text in shown:
            if text == "The AI said":
                continue
            piece = squeezed(text)
            if not left.startswith(piece):
                cut = left[: len(piece)].split("…")[0]
                assert cut, (text, left[:80])
                assert piece.startswith(cut), (text, left[:80])
                piece = cut + "…"
            at = left.find(piece)
            assert at == 0, (text, left[:80])
            left = left[len(piece) :]
        assert left == ""


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_the_preview_pages_draw_the_glyphs_of_the_pdf_pages() -> None:
    pytest.importorskip("typst")
    version = Version(number=1, checksum=CHECKSUM, signed_at=datetime(2026, 10, 15, tzinfo=UTC))
    report = paper_report(paper_of(inputs_of(FIXTURE)), ReportFormat(), DEFAULT_LOCALE)
    pages = svg_pages_of(report, version)
    reader = PdfReader(io.BytesIO(pdf_of(report, version)))
    assert len(pages) == len(reader.pages) == len(FIXTURE["screen"])
    for svg, page in zip(pages, reader.pages, strict=True):
        assert "<text" not in svg
        assert abs(svg.count("<use ") - len(squeezed(page.extract_text()))) <= 1


def test_the_pdf_page_is_the_screen_sheet_in_points() -> None:
    assert round(620 * PAPER_PX, 2) == 595.28
    assert round(877 * PAPER_PX, 1) == 842.0


def test_numbers_round_half_up_like_the_screen() -> None:
    assert fixed(0.125) == "0.13"
    assert fixed(None) == "n/a"
    assert fixed(0.5, 0) == "1"
    assert percent(0.905) == "91%"


def test_dates_are_in_the_readers_zone() -> None:
    clock = Clock(ZoneInfo("Europe/Prague"))
    late = datetime(2026, 10, 15, 22, 30, tzinfo=UTC)
    assert clock.day_month(late) == "16 Oct 2026"
    assert clock.time(late) == "00:30"
    assert Clock(None).day_month(late) == "15 Oct 2026"


def test_the_style_and_its_rule_follow_the_task_settings() -> None:
    settings = DecisionSettings.model_validate(
        {"style": "certainty", "counts_as": ["disagree", "disagree", "unsure", "agree", "agree"]}
    )
    style = style_of(settings)
    assert style == ReviewStyle(kind="certainty", agree_from=4, disagree_to=2)
    assert counts_as_rule(style, "ai") == (
        "4 and 5 count as agree with the AI, 3 as not sure, and 1 and 2 as disagree."
    )
    assert counts_as_rule(ReviewStyle(), "ai") == (
        "Each answer counts as it reads. Not sure stays not sure."
    )


SHEET_CLASSES = {
    "px-11 pt-9 pb-6 text-[10px] leading-[1.4]": "left: 44 * px",
    "w-155": "PAPER_WIDTH",
    "min-h-[877px]": "PAPER_HEIGHT",
    "border-b-[1.5px] border-[#222] pb-3.5": "inset: (bottom: 15 * px)",
    "grid-cols-3 gap-x-4 gap-y-2.5 border-b border-[#ccc] pb-3.5": "column-gutter: 16 * px",
    "grid-cols-2 content-start gap-x-6 gap-y-6": "column-gutter: 24 * px, row-gutter: 24 * px",
    "rounded-[3px] border border-[#ccc] px-2 py-1.5": "inset: (x: 9 * px, y: 7 * px)",
    "grid-cols-[96px_minmax(0,1fr)_22px] items-center gap-2": "(96 * px, 1fr, 22 * px)",
    "h-1.75 bg-[#e6e6e6]": 'height: 7 * px, fill: rgb("#e6e6e6")',
    "rounded-[5px] bg-[#0f766e]": 'radius: 5 * px, fill: rgb("#0f766e")',
}


def test_the_layout_numbers_are_the_report_sheet_classes() -> None:
    screen = (ROOT / "packages" / "ui" / "src" / "components" / "evaluation-report.tsx").read_text()
    layout = (ROOT / "apps" / "api" / "src" / "parfocal_api" / "paper_layout.typ").read_text()
    for classes, drawn in SHEET_CLASSES.items():
        assert classes in screen, classes
        assert drawn in layout, drawn
