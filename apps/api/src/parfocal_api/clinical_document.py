import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from typing import Any

from parfocal_api.evaluation_exports import typst_module
from parfocal_api.report_style import LAYOUT, compile_options

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
FULL_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
NODE_STANDARDS = (
    ("ICCR", "Surgically removed lymph nodes for breast tumours, 1st ed. v1.2"),
    ("CAP", "Synoptic format and element names, Breast Invasive Resection 4.11"),
    ("TNM", "UICC and AJCC 8th edition, pN with (sn) and (i+)"),
)
CATEGORY_NAMES = {
    "macro": "Macrometastasis",
    "micro": "Micrometastasis",
    "itc": "Isolated tumor cells",
}
EXTRANODAL_NAMES = {"present": "Present", "absent": "Absent", "na": "Not assessed"}
PN_OF = {"macro": "pN1a(sn)", "micro": "pN1mi(sn)", "itc": "pN0(i+)(sn)"}
NEGATIVE_PN = "pN0(sn)"
STAGED_TEMPLATE = "sentinel-node"
UNKNOWN_MEMBER = "an unknown member"
DIFF_FIELDS = (
    ("specimen", "Specimen"),
    ("size", "Largest deposit"),
    ("cat", "Category"),
    ("pos", "Nodes positive"),
    ("exam", "Nodes examined"),
    ("ene", "Extranodal extension"),
    ("diag", "Final diagnosis"),
    ("micro", "Microscopic"),
    ("comment", "Comment"),
)
TEXT_DIFFS = ("diag", "micro", "comment")


@dataclass(frozen=True)
class CaseSlide:
    id: str
    label: str
    stain: str
    block_id: str | None


@dataclass(frozen=True)
class SignedVersion:
    number: int
    values: Mapping[str, Any]
    signed_at: datetime
    signed_by: str | None
    reported_by: str | None
    reason: str | None


@dataclass(frozen=True)
class Slide:
    label: str
    node: int
    short: str


@dataclass(frozen=True)
class Deposit:
    id: str
    server_id: str
    slide: str
    object_id: str | None
    size: str
    note: str


def slide_map(slides: Sequence[CaseSlide]) -> dict[str, Slide]:
    blocks = list(dict.fromkeys(slide.block_id for slide in slides if slide.block_id))

    def node(slide: CaseSlide) -> int:
        if slide.block_id:
            return blocks.index(slide.block_id) + 1
        found = re.search(r"\d+", slide.label)
        return int(found.group()) if found else 1

    return {
        slide.id: Slide(
            label=f"{slide.label} · {slide.stain}",
            node=node(slide),
            short=slide.label if slide.stain == "H&E" else f"{slide.label} {slide.stain}",
        )
        for slide in slides
    }


def size_text(value: Any) -> str:
    return "" if value is None else f"{value:g}"


def deposits_of(values: Mapping[str, Any], known: Mapping[str, str]) -> list[Deposit]:
    taken = set(known.values())
    counter = 0

    def fresh() -> str:
        nonlocal counter
        while f"D{counter + 1}" in taken:
            counter += 1
        label = f"D{counter + 1}"
        taken.add(label)
        return label

    return [
        Deposit(
            id=known.get(str(deposit["id"])) or fresh(),
            server_id=str(deposit["id"]),
            slide=str(deposit["slide_id"]),
            object_id=deposit["object_id"],
            size=size_text(deposit["size_mm"]),
            note=deposit["note"] or "",
        )
        for deposit in values["deposits"]
    ]


def deposit_mm(deposit: Deposit | None) -> float | None:
    if deposit is None or not re.fullmatch(r"\d+(\.\d+)?", deposit.size.strip()):
        return None
    number = float(deposit.size.strip())
    return number if 0 < number <= 100 else None


def largest_mm(deposits: Sequence[Deposit]) -> float | None:
    sizes = [size for size in map(deposit_mm, deposits) if size is not None]
    return max(sizes) if sizes else None


def mm_text(value: float) -> str:
    return f"{value:.{2 if value < 1 else 1}f} mm"


def plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def slide_of(slides: Mapping[str, Slide], key: str) -> Slide:
    return slides.get(key) or Slide(label=key, node=1, short=key)


def positive_nodes(slides: Mapping[str, Slide], deposits: Sequence[Deposit]) -> int:
    return len({slide_of(slides, deposit.slide).node for deposit in deposits})


def category_of(values: Mapping[str, Any]) -> str | None:
    category = values["category"]
    return None if category in (None, "none") else str(category)


def suggested_pn(
    slides: Mapping[str, Slide], values: Mapping[str, Any], deposits: Sequence[Deposit]
) -> str | None:
    category = category_of(values)
    if category is None:
        return None if deposits else NEGATIVE_PN
    if category != "macro":
        return PN_OF[category]
    positive = positive_nodes(slides, deposits) or 1
    return "pN3a" if positive > 9 else "pN2a" if positive > 3 else "pN1a(sn)"


def deposit_line(slides: Mapping[str, Slide], deposit: Deposit) -> str:
    slide = slide_of(slides, deposit.slide)
    size = deposit_mm(deposit)
    note = deposit.note.strip()
    source = f"object {deposit.object_id}" if deposit.object_id else "measured by hand"
    shown = "Not measured" if size is None else mm_text(size)
    return f"{shown}, node {slide.node}, slide {slide.label}, {source}" + (
        f". {note}" if note else ""
    )


def deposit_short(slides: Mapping[str, Slide], deposit: Deposit) -> str:
    size = deposit_mm(deposit)
    source = f"{deposit.object_id} on" if deposit.object_id else "by hand on"
    shown = "no size" if size is None else mm_text(size)
    return f"{shown}, {source} {slide_of(slides, deposit.slide).short}"


def examined_text(values: Mapping[str, Any]) -> str:
    return "" if values["nodes_examined"] is None else str(values["nodes_examined"])


def field_text(
    slides: Mapping[str, Slide], name: str, values: Mapping[str, Any], deposits: Sequence[Deposit]
) -> str:
    match name:
        case "size":
            size = largest_mm(deposits)
            return "" if size is None else mm_text(size)
        case "pos":
            return str(positive_nodes(slides, deposits))
        case "cat":
            category = category_of(values)
            return CATEGORY_NAMES[category] if category else ""
        case "ene":
            return EXTRANODAL_NAMES[values["extranodal"]] if values["extranodal"] else ""
        case "exam":
            return examined_text(values).strip()
        case _:
            key = {"diag": "diagnosis", "micro": "microscopic"}.get(name, name)
            return (values[key] or "").strip()


def amendment_changes(
    slides: Mapping[str, Slide],
    before: tuple[Mapping[str, Any], Sequence[Deposit]],
    after: tuple[Mapping[str, Any], Sequence[Deposit]],
) -> list[tuple[str, str | None, str | None]]:
    changed = [
        (name, label)
        for name, label in DIFF_FIELDS
        if field_text(slides, name, *before) != field_text(slides, name, *after)
    ]
    ids = list(dict.fromkeys(deposit.id for deposit in [*before[1], *after[1]]))
    moved: list[tuple[str, str | None, str | None]] = []
    for label in ids:
        was = next((deposit for deposit in before[1] if deposit.id == label), None)
        now = next((deposit for deposit in after[1] if deposit.id == label), None)
        start = deposit_short(slides, was) if was else "none"
        end = deposit_short(slides, now) if now else "removed"
        if start != end:
            moved.append((f"Deposit {label}", start, end))
    return [
        *(
            (
                label,
                field_text(slides, name, *before) or "none",
                field_text(slides, name, *after) or "none",
            )
            for name, label in changed
            if name not in TEXT_DIFFS
        ),
        *moved,
        *((label, None, None) for name, label in changed if name in TEXT_DIFFS),
    ]


def stamp(at: datetime, zone: tzinfo, time: bool = True) -> str:
    moment = at.astimezone(zone)
    day = f"{moment.day} {MONTHS[moment.month - 1]}"
    return f"{day} {moment.hour:02d}:{moment.minute:02d}" if time else day


def long_day(at: datetime, zone: tzinfo) -> str:
    moment = at.astimezone(zone)
    return f"{moment.day} {FULL_MONTHS[moment.month - 1]} {moment.year}"


def long_date(at: datetime, zone: tzinfo) -> str:
    moment = at.astimezone(zone)
    return f"{long_day(at, zone)} at {moment.hour:02d}:{moment.minute:02d}"


def day_with_year(at: datetime, zone: tzinfo) -> str:
    return f"{stamp(at, zone, False)} {at.astimezone(zone).year}"


def stamp_with_year(at: datetime, zone: tzinfo) -> str:
    moment = at.astimezone(zone)
    return f"{moment.day} {MONTHS[moment.month - 1]} {moment.year}, {stamp(at, zone)[-5:]}"


def document_of(
    *,
    lab: str,
    accession: str,
    received_at: datetime | None,
    template: str,
    slides: Sequence[CaseSlide],
    decisions: Sequence[str],
    versions: Sequence[SignedVersion],
    number: int,
    names: Mapping[str, str],
    zone: tzinfo = UTC,
) -> dict[str, Any]:
    ordered = sorted(versions, key=lambda version: version.number)
    first = ordered[0]
    version = next(version for version in ordered if version.number == number)
    shown = slide_map(slides)
    values = version.values
    deposits = deposits_of(values, {})
    amended = number > 1
    signer = names.get(version.signed_by or "", UNKNOWN_MEMBER)
    staged = template == STAGED_TEMPLATE
    size = largest_mm(deposits)
    rows: list[tuple[str, str]] = (
        [
            ("Total number of sentinel lymph nodes examined", examined_text(values)),
            (
                "Number of lymph nodes with metastatic carcinoma",
                str(positive_nodes(shown, deposits)),
            ),
            ("Number of metastatic deposits", str(len(deposits))),
            *((f"Deposit {deposit.id}", deposit_line(shown, deposit)) for deposit in deposits),
            ("Size of largest metastatic deposit", "Not given" if size is None else mm_text(size)),
            (
                "Category",
                CATEGORY_NAMES[category] if (category := category_of(values)) else "Not given",
            ),
            (
                "Extranodal extension",
                EXTRANODAL_NAMES[values["extranodal"]] if values["extranodal"] else "Not given",
            ),
            (
                "Regional lymph nodes, pN (UICC and AJCC TNM 8)",
                suggested_pn(shown, values, deposits) or "Not given",
            ),
        ]
        if staged
        else []
    )
    agreed = sum(1 for decision in decisions if decision == "agree")
    rejected = sum(1 for decision in decisions if decision == "disagree")
    rows.append(
        (
            "AI-assisted analysis",
            f"The AI model flagged {plural(len(decisions), 'region')}. "
            f"The pathologist confirmed {agreed} and rejected {rejected}.",
        )
    )
    reporter = names.get(version.reported_by, UNKNOWN_MEMBER) if version.reported_by else None
    head = [
        (label, value)
        for label, value in (
            ("Accession", accession),
            ("Received", stamp(received_at, zone, False) if received_at else ""),
            (
                "Reported",
                f"{day_with_year(version.signed_at, zone)}, amended"
                if amended
                else stamp_with_year(first.signed_at, zone),
            ),
        )
        if value.strip()
    ]
    after = [
        {"title": title, "body": text}
        for title, key in (("Microscopic description", "microscopic"), ("Comment", "comment"))
        if (text := (values[key] or "").strip())
    ]
    first_deposits = deposits_of(
        first.values, {deposit.server_id: deposit.id for deposit in deposits}
    )
    amendment = (
        {
            "title": f"Amendment, {day_with_year(version.signed_at, zone)}, by {signer}",
            "reason": version.reason or "",
            "changes": [
                list(change)
                for change in amendment_changes(
                    shown, (first.values, first_deposits), (values, deposits)
                )
            ],
            "note": f"Version 1 of {stamp_with_year(first.signed_at, zone)} "
            "stays readable in Parfocal.",
        }
        if amended
        else None
    )
    sections = [
        {"title": title, "body": body, **({"diagnosis": True} if diagnosis else {})}
        for title, body, diagnosis in (
            ("Specimen", values["specimen"] or "", False),
            ("Final diagnosis", values["diagnosis"] or "", True),
        )
        if body.strip()
    ]
    return {
        "status": "amended" if amended else "final",
        "lab": {"name": lab, "department": "", "address": "", "footer": ""},
        "head": [list(pair) for pair in head],
        **({"amendment": amendment} if amendment else {}),
        "sections": sections,
        "synopticTitle": "Synoptic report · Surgically removed lymph nodes for breast tumors"
        if staged
        else "Report elements",
        "standards": [list(pair) for pair in NODE_STANDARDS] if staged else [],
        "rows": [list(pair) for pair in rows],
        "after": after,
        "sign": {
            "by": f"Reported by {reporter}, verified and signed by {signer}"
            if reporter
            else f"Electronically signed by {signer}",
            "at": f"{long_day(version.signed_at, zone)}, signed again"
            if amended
            else long_date(first.signed_at, zone),
        },
    }


SOURCE = (
    LAYOUT
    + """
#let doc = json(bytes(sys.inputs.at("document")))
#set page(paper: "a4", margin: report-margin, footer: context report-footer(grid(
  columns: (1fr, auto),
  doc.at("lab").at("footer"),
  [Page #counter(page).display() of #counter(page).final().first()],
)))
#report-head(
  doc.at("lab").at("name"),
  (doc.at("lab").at("department"), doc.at("lab").at("address")).filter(line => line != ""),
  if doc.at("status") == "amended" { "AMENDED REPORT" } else { "SURGICAL PATHOLOGY REPORT" },
  doc.at("version-line"),
)
#report-meta(doc.at("head"))
#if "amendment" in doc {
  let amendment = doc.at("amendment")
  block(width: 100%, inset: (x: 11pt, y: 9pt), radius: 3pt, fill: rgb("#fdf6dc"),
    stroke: 1pt + rgb("#c9a227"), stack(spacing: report-row-gap,
      text(weight: "bold", amendment.at("title")),
      [Reason: #amendment.at("reason")],
      ..amendment.at("changes").map(change => [
        #text(fill: report-muted)[#change.at(0):]
        #if change.at(1) == none [rewritten] else [
          #strike(change.at(1)) → #text(weight: "bold", change.at(2))
        ]
      ]),
      report-small(amendment.at("note")),
    ))
}
#for section in doc.at("sections") {
  let body = section.at("body")
  report-titled(section.at("title"),
    if section.at("diagnosis", default: false) { text(weight: "semibold", body) } else { body })
}
#report-section(doc.at("synopticTitle"))
#if doc.at("standards").len() > 0 {
  block(width: 100%, report-small(grid(row-gutter: report-row-gap,
    ..doc.at("standards").map(pair => [*#pair.at(0)* #pair.at(1)]))))
}
#block(width: 100%, report-rows(doc.at("rows")))
#for section in doc.at("after") {
  report-titled(section.at("title"), section.at("body"))
}
#block(above: report-gap + report-sign-above, width: 100%, stack(
  report-line(report-rule),
  v(report-sign-inset),
  stack(spacing: report-row-gap,
    text(weight: "bold", doc.at("sign").at("by")),
    [on #doc.at("sign").at("at")],
    report-small[I have reviewed the whole-slide images and rendered this diagnosis.],
  ),
))
"""
)


def version_line(document: Mapping[str, Any], number: int) -> str:
    if document["status"] == "amended":
        return f"Version {number}, replaces version {number - 1}"
    return "Final report, version 1"


def pdf_of(document: Mapping[str, Any], number: int, signed_at: datetime) -> bytes:
    shown = {**document, "version-line": version_line(document, number)}
    return typst_module().compile(
        SOURCE.encode(),
        format="pdf",
        sys_inputs={"document": json.dumps(shown, ensure_ascii=False)},
        timestamp=int(signed_at.astimezone(UTC).timestamp()),
        **compile_options(),
    )
