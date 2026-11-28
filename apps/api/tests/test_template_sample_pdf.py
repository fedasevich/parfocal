import io
import json
import re
from pathlib import Path
from typing import Any, cast

import pytest
from pypdf import PageObject, PdfReader

from parfocal_api.evaluation_exports import Version, pdf_of
from parfocal_api.report_preview import TemplatePreviewDraft
from parfocal_api.report_style import FONT_FAMILY
from parfocal_api.study_templates import BUILT_INS
from parfocal_api.template_sample import (
    region_rows,
    sample_paper,
    sample_report,
    sample_texts,
    sheet_px,
)
from parfocal_common.report_blocks import ReportFormat

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (ROOT / "packages" / "test-fixtures" / "template-sample-screen.json").read_text()
)
SAMPLE = Version(1, "sha256:sample", None)
DRAFT = TemplatePreviewDraft.model_validate(FIXTURE["draft"])


def squeezed(text: str) -> str:
    return re.sub(r"\s+", "", text)


def sample_pdf(draft: TemplatePreviewDraft) -> bytes:
    return pdf_of(sample_report(list(draft.blocks), draft.format), SAMPLE)


def font_names(page: PageObject) -> set[str]:
    fonts: Any = cast("Any", page)["/Resources"]["/Font"]
    return {str(fonts[key].get_object()["/BaseFont"]).split("+")[-1] for key in fonts}


def test_the_sample_model_lists_the_editor_text_page_by_page() -> None:
    pages = sample_texts(sample_paper(list(DRAFT.blocks), DRAFT.format))
    assert len(pages) == len(FIXTURE["screen"])
    for page, shown in zip(pages, FIXTURE["screen"], strict=True):
        assert squeezed("".join(page)) == squeezed("".join(shown))


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_the_sample_pdf_has_every_editor_text_in_order_and_nothing_else() -> None:
    pytest.importorskip("typst")
    reader = PdfReader(io.BytesIO(sample_pdf(DRAFT)))
    assert len(reader.pages) == len(FIXTURE["screen"])
    for page, shown in zip(reader.pages, FIXTURE["screen"], strict=True):
        left = squeezed(page.extract_text())
        assert left.endswith("DRAFT")
        left = left.removesuffix("DRAFT")
        for text in shown:
            piece = squeezed(text)
            assert left.startswith(piece), (text, left[:80])
            left = left[len(piece) :]
        assert left == ""


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
@pytest.mark.parametrize("key", list(BUILT_INS), ids=str)
def test_each_built_in_sample_prints_in_the_app_font_on_its_paper(key: Any) -> None:
    pytest.importorskip("typst")
    template = BUILT_INS[key]
    draft = TemplatePreviewDraft(name=template.name, blocks=template.blocks, format=template.format)
    pages = PdfReader(io.BytesIO(sample_pdf(draft))).pages
    paper = sample_paper(list(draft.blocks), draft.format)
    assert len(pages) == len(paper.sheets)
    for page in pages:
        assert round(float(page.mediabox[2])) == round(paper.width_pt)
        names = font_names(page)
        assert any(name.startswith(FONT_FAMILY.replace(" ", "")) for name in names)
        assert all(name.startswith(("IBMPlex", "LibertinusSerif")) for name in names), names
    text = squeezed(pages[-1].extract_text())
    assert "Checksum" not in text
    assert "SampleprojectSample" not in text


def test_the_page_is_the_editor_sheet_in_points() -> None:
    a4 = sample_paper([], ReportFormat())
    assert round(520 * sheet_px(a4), 2) == 595.28
    wide = sample_paper([], ReportFormat(paper="letter", orientation="landscape"))
    assert round(520 * sheet_px(wide), 1) == 792.0
    assert sample_texts(a4)[0][-3] == "An empty page. Drag a block here or click one on the left."


def test_region_values_round_before_they_step_down_like_the_editor() -> None:
    assert region_rows(["sensitivity"], 1) == (("A1", "0.9"), ("A2", "0.9"), ("B1", "0.8"))
    assert region_rows(["dice"], 2)[2] == ("B1", "0.71")


EDITOR_CLASSES = {
    "max-w-130": "SHEET_WIDTH",
    "gap-3 rounded-sm bg-white p-7": "margin: 28 * px",
    "border-b-[1.5px] border-[#222] pb-2": "inset: (bottom: 8 * px)",
    "border-b border-[#bbb] pb-1": "inset: (bottom: 4 * px)",
    "grid-cols-2 content-start gap-x-2 gap-y-2": "column-gutter: 8 * px, row-gutter: 8 * px",
    "min-w-14 gap-0 border border-[#ccc] px-1.5 py-1": "inset: (x: 7 * px, y: 5 * px)",
    "px-1 py-0.5": "inset: (x: 4 * px, y: 2 * px)",
    "grid-cols-[84px_minmax(0,1fr)_24px] items-center gap-1": "(84 * px, 1fr, 24 * px)",
    "h-14 place-items-center bg-[#efe9dc]": 'height: 56 * px, fill: rgb("#efe9dc")',
    "text-[64px] font-bold text-black/5": 'sized(64, "DRAFT", fill: rgb(0, 0, 0, 5%)',
}


def test_the_layout_numbers_are_the_editor_sheet_classes() -> None:
    screen = (ROOT / "packages/ui/src/components/report-editor-pages.tsx").read_text()
    layout = (ROOT / "apps/api/src/parfocal_api/sample_layout.typ").read_text()
    for classes, drawn in EDITOR_CLASSES.items():
        assert classes in screen, classes
        assert drawn in layout, drawn
