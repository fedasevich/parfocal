from pathlib import Path
from typing import Any

FONTS = Path(__file__).parent / "fonts"
FONT_FAMILY = "IBM Plex Sans"
MARGIN_X_PT = 40
MARGIN_Y_PT = 36
BODY_PT = 11
SMALL_PT = 9
SECTION_PT = 10
FOOTER_PT = 8
LINE_HEIGHT = 1.5
FONT_ASCENT = 1.025
FONT_DESCENT = 0.275
BLOCK_GAP_PT = 6
ROW_GAP_PT = 2
HEADING_ABOVE_PT = 12
HEADING_BELOW_PT = 2
HEAD_BELOW_PT = 8
META_INSET_PT = 6
META_LABEL_PT = 96
SIGN_ABOVE_PT = 16
SIGN_INSET_PT = 8
RULE_PT = 1
STRONG_RULE_PT = 1
INK = "#111111"
MUTED = "#555555"
FOOTER = "#6b6b6b"
RULE = "#bbbbbb"
STRONG_RULE = "#222222"
HALF_LEADING = (LINE_HEIGHT - FONT_ASCENT - FONT_DESCENT) / 2
TOP_EDGE_EM = round(HALF_LEADING + FONT_ASCENT, 4)
BOTTOM_EDGE_EM = round(HALF_LEADING + FONT_DESCENT, 4)

LAYOUT = f"""
#let report-ink = rgb("{INK}")
#let report-muted = rgb("{MUTED}")
#let report-rule = rgb("{RULE}")
#let report-strong-rule = rgb("{STRONG_RULE}")
#let report-margin = (x: {MARGIN_X_PT}pt, y: {MARGIN_Y_PT}pt)
#let report-gap = {BLOCK_GAP_PT}pt
#let report-row-gap = {ROW_GAP_PT}pt
#let report-sign-above = {SIGN_ABOVE_PT}pt
#let report-sign-inset = {SIGN_INSET_PT}pt
#let report-line(paint, width: {RULE_PT}pt) = block(width: 100%, height: width, fill: paint,
  above: 0pt, below: 0pt)
#set text(font: "{FONT_FAMILY}", size: {BODY_PT}pt, fill: report-ink, fallback: true,
  top-edge: {TOP_EDGE_EM}em, bottom-edge: -{BOTTOM_EDGE_EM}em)
#set par(leading: 0pt, spacing: report-gap)
#set block(spacing: report-gap)
#let report-small(body) = text(size: {SMALL_PT}pt, fill: report-muted, body)
#let report-footer(body) = text(size: {FOOTER_PT}pt, fill: rgb("{FOOTER}"), body)
#let report-head(name, name-lines, kind, kind-line) = block(width: 100%, stack(
  grid(
    columns: (1fr, auto),
    column-gutter: 16pt,
    stack(text(size: 13pt, weight: "bold", name), ..name-lines.map(report-small)),
    align(right, stack(
      text(size: 12pt, weight: "bold", kind),
      report-small(kind-line),
    )),
  ),
  v({HEAD_BELOW_PT}pt),
  report-line(report-strong-rule, width: {STRONG_RULE_PT}pt),
))
#let report-meta(pairs) = block(width: 100%, inset: (y: {META_INSET_PT}pt), grid(
  columns: (1fr, 1fr),
  column-gutter: 24pt,
  row-gutter: report-row-gap,
  ..pairs.map(pair => grid(
    columns: ({META_LABEL_PT}pt, 1fr),
    column-gutter: 8pt,
    text(fill: report-muted, pair.at(0)),
    text(weight: "semibold", pair.at(1)),
  )),
))
#let report-heading(title, capitals: true) = block(width: 100%, stack(
  text(size: {SECTION_PT}pt, weight: "bold", tracking: 0.06em, fill: rgb("#333333"),
    if capitals {{ upper(title) }} else {{ title }}),
  v({HEADING_BELOW_PT}pt),
  report-line(report-rule),
))
#let report-section(title, capitals: true) = block(
  above: report-gap + {HEADING_ABOVE_PT}pt,
  below: report-gap,
  report-heading(title, capitals: capitals),
)
#let report-titled(title, body) = block(
  width: 100%,
  above: report-gap + {HEADING_ABOVE_PT}pt,
  grid(row-gutter: report-row-gap, report-heading(title), body),
)
#let report-rows(pairs) = grid(
  columns: (1fr, 1fr),
  column-gutter: 12pt,
  row-gutter: report-row-gap,
  ..pairs.map(pair => (
    text(fill: report-muted)[#pair.at(0):],
    text(weight: "semibold", pair.at(1)),
  )).flatten(),
)
#let report-table(header, rows) = table(
  columns: (if header.len() > 3 {{ 1fr }} else {{ 2fr }}, ..range(header.len() - 1).map(_ => 1fr)),
  stroke: (x, y) => (
    bottom: if y == 0 {{ 0.75pt + report-strong-rule }} else {{ 0.5pt + report-rule }},
  ),
  inset: (x: 4pt, y: 4.5pt),
  align: left,
  table.header(..header.map(cell => text(weight: "semibold", fill: report-muted, cell))),
  ..rows.flatten(),
)
"""


def compile_options() -> dict[str, Any]:
    return {"font_paths": [str(FONTS)], "ignore_system_fonts": True}


PAPER_WIDTH_PX = 620
PAPER_HEIGHT_PX = 877
PAPER_PX = round(595.2756 / PAPER_WIDTH_PX, 6)
PAPER_LINE_HEIGHT = 1.4
PAPER_HALF_LEADING = (PAPER_LINE_HEIGHT - FONT_ASCENT - FONT_DESCENT) / 2
PAPER_TRACKING = 0.0
PAPER_LARGE_TRACKING = 0.0
PAPER_MONO_TRACKING = 0.0
PAPER_TEMPLATE = Path(__file__).parent / "paper_layout.typ"


LETTER_PX = (round(612 / PAPER_PX, 2), round(792 / PAPER_PX, 2))


def paper_layout(letter: bool = False, landscape: bool = False) -> str:
    width, height = LETTER_PX if letter else (PAPER_WIDTH_PX, PAPER_HEIGHT_PX)
    if landscape:
        width, height = height, width
    return (
        PAPER_TEMPLATE.read_text()
        .replace("PAPER_MONO_TRACKING", str(PAPER_MONO_TRACKING))
        .replace("PAPER_LARGE_TRACKING", str(PAPER_LARGE_TRACKING))
        .replace("PAPER_TRACKING", str(PAPER_TRACKING))
        .replace("PAPER_PX", str(PAPER_PX))
        .replace("PAPER_TOP_EDGE", str(round(PAPER_HALF_LEADING + FONT_ASCENT, 4)))
        .replace("PAPER_BOTTOM_EDGE", str(round(PAPER_HALF_LEADING + FONT_DESCENT, 4)))
        .replace("PAPER_WIDTH", str(width))
        .replace("PAPER_HEIGHT", str(height))
    )
