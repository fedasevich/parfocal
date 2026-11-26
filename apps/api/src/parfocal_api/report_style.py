from pathlib import Path
from typing import Any

FONTS = Path(__file__).parent / "fonts"
FONT_FAMILY = "IBM Plex Sans"
MARGIN_X_PT = 40
MARGIN_Y_PT = 36
BODY_PT = 11
SMALL_PT = 9
SECTION_PT = 10
INK = "#111111"
MUTED = "#555555"
RULE = "#bbbbbb"
STRONG_RULE = "#222222"

LAYOUT = f"""
#let report-ink = rgb("{INK}")
#let report-muted = rgb("{MUTED}")
#let report-rule = rgb("{RULE}")
#let report-strong-rule = rgb("{STRONG_RULE}")
#let report-margin = (x: {MARGIN_X_PT}pt, y: {MARGIN_Y_PT}pt)
#set text(font: "{FONT_FAMILY}", size: {BODY_PT}pt, fill: report-ink, fallback: true)
#set par(leading: 0.55em, spacing: 0.8em)
#let report-small(body) = text(size: {SMALL_PT}pt, fill: report-muted, body)
#let report-head(name, name-lines, kind, kind-line) = block(
  width: 100%,
  inset: (bottom: 7pt),
  below: 8pt,
  stroke: (bottom: 1.5pt + report-strong-rule),
  grid(
    columns: (1fr, auto),
    column-gutter: 16pt,
    stack(spacing: 4pt, text(size: 13pt, weight: "bold", name), ..name-lines.map(report-small)),
    align(right, stack(spacing: 4pt,
      text(size: 12pt, weight: "bold", kind),
      report-small(kind-line),
    )),
  ),
)
#let report-meta(pairs) = block(below: 10pt, grid(
  columns: (1fr, 1fr),
  column-gutter: 24pt,
  row-gutter: 5pt,
  ..pairs.map(pair => grid(
    columns: (72pt, 1fr),
    column-gutter: 8pt,
    text(fill: report-muted, pair.at(0)),
    text(weight: "semibold", pair.at(1)),
  )),
))
#let report-section(title, capitals: true) = block(
  width: 100%,
  above: 14pt,
  below: 6pt,
  inset: (bottom: 3pt),
  stroke: (bottom: 0.5pt + report-rule),
  text(size: {SECTION_PT}pt, weight: "bold", tracking: 0.06em, fill: rgb("#333333"),
    if capitals {{ upper(title) }} else {{ title }}),
)
#let report-rows(pairs) = grid(
  columns: (1fr, 1fr),
  column-gutter: 12pt,
  row-gutter: 5pt,
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
