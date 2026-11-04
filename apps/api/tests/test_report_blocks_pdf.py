import io
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_evaluation_api import scenario
from test_evaluation_exports import exported
from test_locales import EMPTY_REPORT, FULL_BLOCKS, FULL_REPORT
from workspace_support import owner, person

from parfocal_api.evaluation_exports import Version, pdf_of
from parfocal_api.report_template import ReportData, render_report
from parfocal_api.tables import Role
from parfocal_common.report_blocks import BLOCKS, ReportFormat, TextBlock
from parfocal_common.report_layout import report_pages

LAYOUTS = Path(__file__).parents[3] / "packages" / "test-fixtures" / "report-layout.json"
SIGNED = Version(1, "sha256:0123abcd", datetime(2026, 11, 3, 12, tzinfo=UTC))
DRAFT = Version(1, "sha256:0123abcd", None)
SETTINGS: dict[str, dict[str, Any]] = {
    "headline-numbers": {"metrics": ["dice"]},
    "comparison": {"metrics": ["dice"]},
    "region-metrics": {"columns": ["dice"]},
    "slide-table": {"columns": ["objects"]},
    "reviewer-agreement": {"parts": ["regions"]},
}


def pages_of(pdf: bytes) -> list[str]:
    return [
        " ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages
    ]


def layout_cases() -> list[dict[str, Any]]:
    return list(json.loads(LAYOUTS.read_text())["cases"])


def case_blocks(case: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(
        BLOCKS.validate_python(
            [
                {**block, "title": f"BLOCK{index:02d}", **SETTINGS.get(block["kind"], {})}
                for index, block in enumerate(case["blocks"])
            ]
        )
    )


def test_every_block_kind_prints_its_own_content() -> None:
    text = " ".join(pages_of(pdf_of(render_report(FULL_REPORT), SIGNED)))
    for expected in (
        "Dice 0.60",
        "CLASS-SENTINEL",
        "OTHER-SENTINEL",
        "Fleiss kappa 0.41",
        "Cell agreement between reviewers 0.75",
        "REASON-SENTINEL 2",
        "QUESTION-SENTINEL 2 3.00",
        "T1 CLASS-SENTINEL 1 1 0 CONSENSUS-SENTINEL",
        "SLIDE-SENTINEL 1 1 Not recorded",
        "CAPTION-SENTINEL",
        "The slide image shows on the report page",
        "METHODS-SENTINEL",
        "Dice 0.60 0.40",
        "COMPARED-SENTINEL",
        "Appendix: objects",
        "Appendix: decisions",
        "REVIEWER-SENTINEL DECISION-SENTINEL",
        "Appendix: methods",
        "Signed by",
    ):
        assert expected in text, (expected, text)
    assert "not in the PDF yet" not in text
    for block in FULL_BLOCKS:
        assert block.title in text


def test_a_block_with_nothing_to_show_says_why() -> None:
    text = " ".join(pages_of(pdf_of(render_report(EMPTY_REPORT), DRAFT)))
    for expected in (
        "This task has no regions to measure.",
        "This task has no cells, so there are no cell types to compare.",
        "Agreement needs two reviewers who answered the same objects.",
        "No reviewer gave a reason for disagreeing.",
        "No reviewer answered the opinion form.",
        "No object has a decision yet.",
        "No slide in this task has objects to review.",
        "Pick a slide for this figure.",
        "This text block is empty.",
        "Pick a review task to compare with.",
        "The review task to compare with is not available.",
    ):
        assert expected in text, (expected, text)


@pytest.mark.parametrize("case", layout_cases(), ids=lambda case: case["name"])
def test_the_page_plan_matches_the_shared_layout(case: dict[str, Any]) -> None:
    planned = report_pages(case_blocks(case), ReportFormat(**case["format"]))
    assert [page.as_json() for page in planned] == case["pages"]


@pytest.mark.parametrize("case", layout_cases(), ids=lambda case: case["name"])
def test_the_pdf_prints_the_planned_blocks_on_the_planned_pages(case: dict[str, Any]) -> None:
    data = replace(
        EMPTY_REPORT,
        blocks=case_blocks(case),
        format=ReportFormat(**case["format"], page_numbers="none", running_header=False),
    )
    printed = pages_of(pdf_of(render_report(data), DRAFT))
    assert len(printed) == len(case["pages"])
    for page, text in zip(case["pages"], printed, strict=True):
        expected = [f"BLOCK{index:02d}" for row in page["rows"] for index in row]
        found = sorted(
            (text.index(title), title)
            for title in (f"BLOCK{index:02d}" for index in range(len(case["blocks"])))
            if title in text
        )
        assert [title for _, title in found] == expected, (page, text)
        assert ("Decisions" in text) == page["closing"]


def test_the_format_sets_paper_numbers_watermark_language_and_decimals() -> None:
    data = replace(
        FULL_REPORT,
        signed_off_on=None,
        headline={"dice": 0.6},
        blocks=(FULL_BLOCKS[0],),
        format=ReportFormat(
            paper="letter",
            orientation="landscape",
            page_numbers="page-of",
            label_language="de",
            decimals=3,
            signature=False,
            appendices=["methods"],
        ),
    )
    pdf = pdf_of(render_report(data), DRAFT)
    reader = PdfReader(io.BytesIO(pdf))
    box = reader.pages[0].mediabox
    assert (round(float(box.width)), round(float(box.height))) == (792, 612)
    printed = pages_of(pdf)
    assert "1 / 2" in printed[0]
    assert "2 / 2" in printed[1]
    assert "ENTWURF" in printed[0]
    assert "Auswertungsbericht" in printed[0]
    assert "Dice 0,600" in printed[0]
    assert "Unterschrift" not in " ".join(printed)
    english = pages_of(
        pdf_of(
            render_report(
                replace(
                    data,
                    signed_off_on=SIGNED.signed_at.date() if SIGNED.signed_at else None,
                    format=ReportFormat(page_numbers="none", decimals=1),
                )
            ),
            SIGNED,
        )
    )
    first = english[0]
    assert "Dice 0.6" in first
    assert "Dice 0.60" not in first
    assert "DRAFT" not in first
    assert "1 / " not in first
    portrait = pdf_of(render_report(replace(data, format=ReportFormat())), DRAFT)
    assert round(float(PdfReader(io.BytesIO(portrait)).pages[0].mediabox.width)) == 595


def test_a_title_hidden_block_prints_without_its_heading() -> None:
    hidden = TextBlock(kind="text", title="HIDDEN-TITLE", show_title=False, body="Shown body.")
    data: ReportData = replace(EMPTY_REPORT, blocks=(hidden,))
    text = " ".join(pages_of(pdf_of(render_report(data), DRAFT)))
    assert "Shown body." in text
    assert "HIDDEN-TITLE" not in text


def created_template(api: ApiAs, admin: Any, name: str, blocks: list[dict[str, Any]]) -> str:
    response = api(admin).post(
        "/api/study-templates",
        json={
            "name": name,
            "study_kind": "regions",
            "blocks": blocks,
            "presets": {"objects_to_check": {"kind": "all-regions"}},
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


@pytest.mark.db
def test_a_signed_report_keeps_its_layout_after_the_template_changes(
    api: ApiAs, database: str
) -> None:
    r = scenario(api, database)
    admin = person(
        database, r.people["owner"].tenant_id, "admin", Role.RESEARCHER, admin_rights=True
    )
    signed_blocks = [
        {"kind": "text", "title": "SIGNED-FIRST", "body": "Read blind."},
        {"kind": "headline-numbers", "title": "SIGNED-SECOND", "metrics": ["dice"]},
    ]
    template = created_template(api, admin, "Signed layout", signed_blocks)
    owner(
        database,
        f"UPDATE review_tasks SET study_template_id = '{template}', study_template_version = 1, "
        f"signed_off_at = '2026-11-03T12:00:00+00:00' WHERE id = '{r.task}'",
    )
    before = exported(api, r, "report.pdf").content
    edited = api(admin).put(
        f"/api/study-templates/{template}",
        json={
            "name": "Signed layout",
            "study_kind": "regions",
            "blocks": [{"kind": "text", "title": "LATER-ONLY", "body": "Changed later."}],
            "format": {"paper": "letter", "orientation": "landscape"},
            "presets": {"objects_to_check": {"kind": "all-regions"}},
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["version"] == 2
    after = exported(api, r, "report.pdf").content
    assert after == before
    text = " ".join(pages_of(after))
    assert text.index("SIGNED-FIRST") < text.index("SIGNED-SECOND")
    assert "LATER-ONLY" not in text
    assert "Signed off: 03/11/2026" in text
