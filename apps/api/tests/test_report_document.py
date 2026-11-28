import io
import json
import re
from datetime import UTC, datetime, tzinfo
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from pypdf import PdfReader

from parfocal_api.clinical_document import CaseSlide, SignedVersion, document_of, pdf_of
from parfocal_api.reader_zone import UnknownTimeZoneError, zone_of
from parfocal_api.report_style import (
    BLOCK_GAP_PT,
    BODY_PT,
    BOTTOM_EDGE_EM,
    FONT_ASCENT,
    FONT_DESCENT,
    FONT_FAMILY,
    FOOTER,
    FOOTER_PT,
    HEAD_BELOW_PT,
    HEADING_ABOVE_PT,
    HEADING_BELOW_PT,
    LINE_HEIGHT,
    MARGIN_X_PT,
    MARGIN_Y_PT,
    META_INSET_PT,
    META_LABEL_PT,
    ROW_GAP_PT,
    SIGN_ABOVE_PT,
    SIGN_INSET_PT,
    SMALL_PT,
    TOP_EDGE_EM,
)

ROOT = Path(__file__).parents[3]
FIXTURE = ROOT / "packages" / "test-fixtures" / "report-document.json"
SCREEN = ROOT / "packages" / "ui" / "src" / "components" / "clinical-report.tsx"
CASES: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def moment(text: str) -> datetime:
    return datetime.fromisoformat(text)


def server_document(item: dict[str, Any], zone: tzinfo = UTC) -> dict[str, Any]:
    specimen = item["case"]["specimens"][0]
    return document_of(
        lab=item["lab"],
        accession=item["case"]["label"],
        received_at=moment(specimen["received_at"]) if specimen["received_at"] else None,
        template=item["report"]["template"]["key"],
        slides=[
            CaseSlide(slide["id"], slide["label"], slide["stain"], slide["block_id"])
            for slide in item["case"]["slides"]
        ],
        decisions=[found["decision"] for found in item["report"]["findings"]["decisions"]],
        versions=[
            SignedVersion(
                number=version["number"],
                values=version["values"],
                signed_at=moment(version["signed_at"]),
                signed_by=version["signed_by_user_id"],
                reported_by=version["reported_by_user_id"],
                reason=version["reason"],
            )
            for version in item["versions"]
        ],
        number=item["versions"][-1]["number"],
        names=item["names"],
        zone=zone,
    )


def text_of(pdf: bytes) -> str:
    return " ".join(
        " ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages
    )


@pytest.mark.parametrize("item", CASES, ids=[item["name"] for item in CASES])
def test_the_server_model_matches_the_on_screen_model(item: dict[str, Any]) -> None:
    assert server_document(item) == item["expected"]


@pytest.mark.parametrize("item", CASES, ids=[item["name"] for item in CASES])
def test_the_pdf_prints_every_heading_label_and_value_of_the_preview(item: dict[str, Any]) -> None:
    document = item["expected"]
    number = item["versions"][-1]["number"]
    pdf = pdf_of(server_document(item), number, moment(item["versions"][-1]["signed_at"]))
    text = text_of(pdf)
    shown: list[str] = [
        document["lab"]["name"],
        "AMENDED REPORT" if document["status"] == "amended" else "SURGICAL PATHOLOGY REPORT",
        *(f"{label} {value}" for label, value in document["head"]),
        *(section["title"].upper() for section in [*document["sections"], *document["after"]]),
        *(section["body"] for section in [*document["sections"], *document["after"]]),
        document["synopticTitle"].upper(),
        *(f"{name} {words}" for name, words in document["standards"]),
        *(f"{label}: {value}".strip() for label, value in document["rows"]),
        document["sign"]["by"],
        f"on {document['sign']['at']}",
    ]
    if "amendment" in document:
        shown += [document["amendment"]["title"], f"Reason: {document['amendment']['reason']}"]
    for expected in shown:
        assert expected in text, expected
    assert not re.search(r"\b(na|none|macro|micro|itc)\b", text.split("AI-assisted")[0])


def test_the_pdf_uses_the_screen_font_and_a4_margins() -> None:
    item = CASES[0]
    pdf = pdf_of(server_document(item), 1, moment(item["versions"][0]["signed_at"]))
    page = PdfReader(io.BytesIO(pdf)).pages[0]
    assert [round(float(side)) for side in page.mediabox] == [0, 0, 595, 842]
    fonts: Any = cast("Any", page)["/Resources"]["/Font"]
    names = {str(fonts[key].get_object()["/BaseFont"]).split("+")[-1] for key in fonts}
    assert names
    assert all(name.startswith(FONT_FAMILY.replace(" ", "")) for name in names)
    screen = SCREEN.read_text(encoding="utf-8")
    assert f"px-{MARGIN_X_PT // 4} py-{MARGIN_Y_PT // 4}" in screen
    assert "max-w-[595px]" in screen


def signed_at(item: dict[str, Any], at: str) -> dict[str, Any]:
    return {**item, "versions": [{**version, "signed_at": at} for version in item["versions"]]}


def test_the_document_prints_its_times_in_the_readers_zone() -> None:
    item = signed_at(CASES[0], "2026-11-23T21:17:00+00:00")
    prague = server_document(item, ZoneInfo("Europe/Prague"))
    assert dict(prague["head"])["Reported"] == "23 Nov 2026, 22:17"
    assert prague["sign"]["at"] == "23 November 2026 at 22:17"
    assert dict(server_document(item)["head"])["Reported"] == "23 Nov 2026, 21:17"
    text = text_of(pdf_of(prague, 1, moment("2026-11-23T21:17:00+00:00")))
    assert "Reported 23 Nov 2026, 22:17" in text
    assert "21:17" not in text


def test_a_signing_near_midnight_moves_the_day_and_year_with_the_zone() -> None:
    item = signed_at(CASES[0], "2026-12-31T23:30:00+00:00")
    prague = server_document(item, ZoneInfo("Europe/Prague"))
    assert dict(prague["head"])["Reported"] == "1 Jan 2027, 00:30"
    assert prague["sign"]["at"] == "1 January 2027 at 00:30"
    los_angeles = server_document(item, ZoneInfo("America/Los_Angeles"))
    assert dict(los_angeles["head"])["Reported"] == "31 Dec 2026, 15:30"


def test_an_unknown_zone_is_refused_and_no_zone_means_utc() -> None:
    assert zone_of(None) == ZoneInfo("UTC")
    assert zone_of("Europe/Prague") == ZoneInfo("Europe/Prague")
    for name in ("Mars/Olympus", "../../etc/passwd", "Europe/"):
        with pytest.raises(UnknownTimeZoneError):
            zone_of(name)


def text_lines(pdf: bytes) -> list[tuple[float, float, str]]:
    lines: list[tuple[float, float, str]] = []

    def seen(text: str, cm: Any, tm: Any, _font: Any, _size: Any) -> None:
        if text.strip():
            x, y = float(tm[4]), float(tm[5])
            left = x * float(cm[0]) + y * float(cm[2]) + float(cm[4])
            baseline = x * float(cm[1]) + y * float(cm[3]) + float(cm[5])
            lines.append((left, baseline, text.strip()))

    PdfReader(io.BytesIO(pdf)).pages[0].extract_text(visitor_text=seen)
    return lines


def baseline_of(lines: list[tuple[float, float, str]], start: str) -> float:
    return next(baseline for _, baseline, text in lines if text.startswith(start))


def test_the_pdf_spaces_its_lines_and_rows_as_the_screen_does() -> None:
    item = CASES[0]
    lines = text_lines(pdf_of(server_document(item), 1, moment(item["versions"][0]["signed_at"])))
    line = BODY_PT * LINE_HEIGHT
    row = line + ROW_GAP_PT
    nodes = baseline_of(lines, "Number of lymph nodes with")
    wrapped = baseline_of(lines, "carcinoma:")
    assert baseline_of(lines, "Total number of sentinel") - nodes == pytest.approx(row, abs=0.05)
    assert nodes - wrapped == pytest.approx(line, abs=0.05)
    assert wrapped - baseline_of(lines, "Number of metastatic") == pytest.approx(row, abs=0.05)
    assert baseline_of(lines, "Deposit D1") - baseline_of(lines, "Deposit D2") == pytest.approx(
        row, abs=0.05
    )
    standard = SMALL_PT * LINE_HEIGHT + ROW_GAP_PT
    assert baseline_of(lines, "ICCR") - baseline_of(lines, "CAP") == pytest.approx(
        standard, abs=0.05
    )
    assert baseline_of(lines, "CAP") - baseline_of(lines, "TNM") == pytest.approx(
        standard, abs=0.05
    )
    assert baseline_of(lines, "Accession") - baseline_of(lines, "Reported") == pytest.approx(
        row, abs=0.05
    )
    page_top = 841.89
    assert page_top - baseline_of(lines, item["lab"]) == pytest.approx(
        MARGIN_Y_PT + 13 * TOP_EDGE_EM, abs=0.05
    )
    value = next(left for left, _, text in lines if text.startswith("2.5 mm"))
    assert value == pytest.approx(MARGIN_X_PT + (595.28 - 2 * MARGIN_X_PT + 12) / 2, abs=0.05)


def test_the_layout_numbers_are_the_screen_classes() -> None:
    screen = SCREEN.read_text(encoding="utf-8")
    assert pytest.approx(LINE_HEIGHT) == TOP_EDGE_EM + BOTTOM_EDGE_EM
    assert pytest.approx(FONT_ASCENT - FONT_DESCENT) == TOP_EDGE_EM - BOTTOM_EDGE_EM
    for expected in (
        f"leading-[{LINE_HEIGHT}]",
        f"content-start gap-{BLOCK_GAP_PT / 4:g}",
        f'<dl className="m-0 grid gap-{ROW_GAP_PT / 4:g}">',
        f"grid gap-{ROW_GAP_PT / 4:g} text-[{SMALL_PT}px]",
        f"gap-y-{ROW_GAP_PT / 4:g} py-{META_INSET_PT / 4:g}",
        f"m-0 mt-{HEADING_ABOVE_PT // 4} border-b border-[#bbb] pb-{HEADING_BELOW_PT / 4:g}",
        f"pb-{HEAD_BELOW_PT // 4}",
        f"w-{META_LABEL_PT // 4} shrink-0",
        f"mt-{SIGN_ABOVE_PT // 4} grid gap-{ROW_GAP_PT / 4:g} border-t border-[#bbb] "
        f"pt-{SIGN_INSET_PT // 4}",
        f"text-[{FOOTER_PT}px] text-[{FOOTER}]",
    ):
        assert expected in screen, expected
