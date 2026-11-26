import io
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import pytest
from pypdf import PdfReader

from parfocal_api.clinical_document import CaseSlide, SignedVersion, document_of, pdf_of
from parfocal_api.report_style import FONT_FAMILY, MARGIN_X_PT, MARGIN_Y_PT

ROOT = Path(__file__).parents[3]
FIXTURE = ROOT / "packages" / "test-fixtures" / "report-document.json"
SCREEN = ROOT / "packages" / "ui" / "src" / "components" / "clinical-report.tsx"
CASES: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def moment(text: str) -> datetime:
    return datetime.fromisoformat(text)


def server_document(item: dict[str, Any]) -> dict[str, Any]:
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
