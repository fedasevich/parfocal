import json
from datetime import UTC, datetime
from typing import Any

from parfocal_api.evaluation_exports import PdfUnavailableError

SOURCE = """
#set page(paper: "a4", margin: 2cm)
#set text(size: 10.5pt)
#let facts = json(bytes(sys.inputs.at("facts")))
#text(size: 18pt, weight: "bold")[Clinical report]
#v(2pt)
#facts.at("case"), #facts.at("template"), version #facts.at("version")
#line(length: 100%)
#for row in facts.at("rows") [
  #grid(columns: (4cm, 1fr), gutter: 6pt, text(weight: "bold")[#row.at(0)], [#row.at(1)])
  #v(4pt)
]
#v(6pt)
#text(weight: "bold")[Deposits]
#for entry in facts.at("deposits") [
  - #entry
]
#v(1fr)
#line(length: 100%)
#facts.at("signature")
"""

NONE = "Not stated"


def size_text(size_mm: float | None) -> str:
    return "size missing" if size_mm is None else f"{size_mm:.1f} mm"


def deposit_line(deposit: dict[str, Any]) -> str:
    source = deposit["object_id"] or "measured by hand"
    note = f", {deposit['note']}" if deposit["note"] else ""
    largest = ", largest" if deposit["largest"] else ""
    return f"{source}, {size_text(deposit['size_mm'])}{largest}{note}"


def signature_line(
    signer: str, signed_at: datetime, reported_by: str | None, reason: str | None
) -> str:
    when = signed_at.astimezone(UTC).strftime("%d %b %Y %H:%M UTC")
    text = f"Signed out {when} by {signer}"
    if reported_by:
        text += f", reported by {reported_by}"
    if reason:
        text += f". Amended: {reason}"
    return text


def facts_of(
    case_label: str,
    template_name: str,
    number: int,
    content: dict[str, Any],
    signer: str,
    signed_at: datetime,
    reported_by: str | None,
    reason: str | None,
) -> dict[str, Any]:
    values = content["values"]
    staging = content["staging"]
    examined = values["nodes_examined"]
    rows = [
        ("Specimen", values["specimen"] or NONE),
        ("Category", values["category"] or NONE),
        ("Suggested pN", staging["suggested_pn"] if staging else NONE),
        ("Nodes examined", NONE if examined is None else str(examined)),
        ("Extranodal extension", values["extranodal"] or NONE),
        ("Final diagnosis", values["diagnosis"] or NONE),
        ("Microscopic description", values["microscopic"] or NONE),
        ("Comment", values["comment"] or NONE),
    ]
    return {
        "case": case_label,
        "template": template_name,
        "version": number,
        "rows": rows,
        "deposits": [deposit_line(deposit) for deposit in values["deposits"]] or [NONE],
        "signature": signature_line(signer, signed_at, reported_by, reason),
    }


def pdf_of(facts: dict[str, Any], signed_at: datetime) -> bytes:
    try:
        import typst
    except ImportError as missing:
        raise PdfUnavailableError from missing
    return typst.compile(
        SOURCE.encode(),
        format="pdf",
        sys_inputs={"facts": json.dumps(facts, ensure_ascii=False)},
        ignore_system_fonts=True,
        timestamp=int(signed_at.astimezone(UTC).timestamp()),
    )
