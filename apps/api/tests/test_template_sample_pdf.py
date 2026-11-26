import io
from pathlib import Path
from typing import Any, cast

import pytest
from pypdf import PageObject, PdfReader

from parfocal_api.evaluation_exports import Version, pdf_of
from parfocal_api.report_preview import TemplatePreviewDraft, sample_data
from parfocal_api.report_style import (
    BODY_PT,
    FONT_FAMILY,
    MARGIN_X_PT,
    MARGIN_Y_PT,
    RULE,
    SECTION_PT,
    SMALL_PT,
)
from parfocal_api.report_template import render_report
from parfocal_api.study_templates import BUILT_INS

SCREEN = (
    Path(__file__).parents[3] / "packages" / "ui" / "src" / "components" / "clinical-report.tsx"
)
A4 = (595, 842)
SAMPLE = Version(1, "sha256:sample", None)


def sample_pdf(key: Any) -> tuple[bytes, str]:
    draft = BUILT_INS[key]
    report = render_report(
        sample_data(TemplatePreviewDraft(name=draft.name, blocks=draft.blocks, format=draft.format))
    )
    return pdf_of(report, SAMPLE), report.source


def font_names(page: PageObject) -> set[str]:
    fonts: Any = cast("Any", page)["/Resources"]["/Font"]
    return {str(fonts[key].get_object()["/BaseFont"]).split("+")[-1] for key in fonts}


def text_spots(page: PageObject) -> list[tuple[float, float]]:
    spots: list[tuple[float, float]] = []

    def seen(text: str, cm: Any, tm: Any, _fonts: Any, _size: Any) -> None:
        if text.strip():
            x, y = float(tm[4]), float(tm[5])
            spots.append(
                (
                    x * float(cm[0]) + y * float(cm[2]) + float(cm[4]),
                    x * float(cm[1]) + y * float(cm[3]) + float(cm[5]),
                )
            )

    page.extract_text(visitor_text=seen)
    return spots


@pytest.mark.parametrize("key", list(BUILT_INS), ids=str)
def test_each_template_sample_prints_in_the_screen_font_on_a4_with_its_margins(key: Any) -> None:
    pdf, _ = sample_pdf(key)
    pages = PdfReader(io.BytesIO(pdf)).pages
    for page in pages:
        assert tuple(round(float(side)) for side in page.mediabox[2:]) == A4
        names = font_names(page)
        assert names
        assert all(name.startswith(FONT_FAMILY.replace(" ", "")) for name in names), names
    spots = text_spots(pages[0])
    left = min(x for x, _ in spots)
    top = max(y for _, y in spots)
    assert MARGIN_X_PT - 1 <= left <= MARGIN_X_PT + 2
    assert A4[1] - top <= MARGIN_Y_PT + 20
    assert max(x for x, _ in spots) > A4[0] / 2


@pytest.mark.parametrize("key", list(BUILT_INS), ids=str)
def test_each_template_sample_uses_the_shared_heading_metadata_and_ruled_tables(key: Any) -> None:
    pdf, source = sample_pdf(key)
    assert "#report-head(" in source
    assert "#report-meta((" in source
    assert "#report-table(" in source
    assert "#table(columns:" not in source
    assert "\n= " not in source
    assert "\n== " not in source
    text = " ".join(
        " ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages
    )
    assert "Checksum sha256:sample" in text
    assert "Checksum:" not in text
    assert "Project:" not in text


def test_the_shared_layout_takes_its_numbers_from_the_on_screen_report() -> None:
    screen = SCREEN.read_text(encoding="utf-8")
    for expected in (
        "max-w-[595px]",
        f"px-{MARGIN_X_PT // 4} py-{MARGIN_Y_PT // 4}",
        f"text-[{BODY_PT}px]",
        f"text-[{SMALL_PT}px]",
        f"text-[{SECTION_PT}px] font-bold tracking-[0.06em]",
        f"border-[{RULE[:4]}]",
    ):
        assert expected in screen, expected
