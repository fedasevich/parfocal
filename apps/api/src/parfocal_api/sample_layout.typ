#let px = SHEET_PX * 1pt
#let paper = json(bytes(sys.inputs.paper))
#let em = paper.text_size
#let ink = rgb("#111111")
#let dim-ink = rgb("#555555")
#set text(font: "IBM Plex Sans", size: em * px, fill: ink, fallback: true,
  top-edge: SHEET_TOP_EDGEem, bottom-edge: -SHEET_BOTTOM_EDGEem)
#set par(leading: 0pt, spacing: 0pt, justify: false)
#set block(spacing: 0pt)
#let sized(size, body, fill: auto, weight: "regular") = text(size: size * px,
  fill: if fill == auto { ink } else { fill }, weight: weight, body)
#let stacked(gap, items) = grid(columns: (100%,), row-gutter: gap * px, ..items)
#let ruled(width, color, body) = block(width: 100%, inset: (bottom: width * px),
  outset: (bottom: -width / 2 * px), stroke: (bottom: width * px + color), body)

#let letterhead() = ruled(1, rgb("#222222"), block(inset: (bottom: 8 * px),
  grid(columns: (auto, 1fr, auto),
    stacked(0, (..if paper.logo { (sized(em * 1.15, paper.brand, weight: "bold"),) } else { () },
      sized(em * 0.8, paper.project, fill: dim-ink))),
    [],
    align(right, stacked(0, (sized(em * 1.15, paper.title, weight: "bold"),
      sized(em * 0.8, paper.subtitle, fill: dim-ink)))))))

#let running() = ruled(1, rgb("#bbbbbb"), block(inset: (bottom: 4 * px),
  grid(columns: (auto, 1fr, auto), sized(em * 0.8, paper.title, fill: dim-ink), [],
    sized(em * 0.8, paper.subtitle, fill: dim-ink))))

#let card(found) = context {
  let body = stack(sized(12, found.at(0), weight: "bold"), sized(8, found.at(1), fill: dim-ink))
  let narrow = measure(body).width + 14 * px < 56 * px
  box(width: if narrow { 56 * px } else { auto }, inset: (x: 7 * px, y: 5 * px), outset: -0.5 * px,
    stroke: 1 * px + rgb("#cccccc"), body)
}

#let cards(part) = layout(size => {
  let rows = ((),)
  let used = 0pt
  for found in part.cards {
    let one = card(found)
    let wide = measure(one, width: size.width).width
    if rows.last().len() > 0 and used + 6 * px + wide > size.width {
      rows.push(())
      used = 0pt
    }
    used += if rows.last().len() > 0 { 6 * px + wide } else { wide }
    rows.last().push(one)
  }
  stacked(6, rows.map(row => stack(dir: ltr, spacing: 6 * px, ..row)))
})

#let table-row(widths, cells, color, weight) = ruled(1, color,
  grid(columns: widths, inset: (x: 4 * px, y: 2 * px),
    ..cells.map(cell => sized(9, cell, weight: weight))))

#let sample-table(part) = layout(size => {
  let wide = range(part.head.len()).map(at => calc.max(
    measure(sized(9, part.head.at(at), weight: "semibold")).width,
    ..part.rows.map(row => measure(sized(9, row.at(at))).width)) + 8 * px)
  let total = wide.fold(0pt, (sum, one) => sum + one)
  let widths = wide.map(one => size.width * (one / total))
  stacked(0, (table-row(widths, part.head, rgb("#bbbbbb"), "semibold"),
    ..part.rows.map(row => table-row(widths, row, rgb("#e5e5e5"), "regular"))))
})

#let bars(part) = stacked(2, part.rows.map(row => grid(columns: (84 * px, 1fr, 24 * px),
  column-gutter: 4 * px, align: horizon,
  sized(9, row.at(0)),
  block(width: 100%, height: 6 * px, fill: rgb("#e5e5e5"),
    block(width: 100% * row.at(1) / 100, height: 100%, fill: rgb("#1d5fd1"))),
  align(right, sized(9, str(row.at(1)) + "%")))))

#let figure-part(part) = stacked(2, (
  block(width: 100%, height: 56 * px, fill: rgb("#efe9dc"),
    align(center + horizon, sized(9, part.layers, fill: dim-ink))),
  ..if part.caption != "" { (sized(9, part.caption, fill: dim-ink),) } else { () },
))

#let part-of(part) = {
  if part.kind == "cards" { cards(part) }
  else if part.kind == "table" { sample-table(part) }
  else if part.kind == "bars" { bars(part) }
  else if part.kind == "figure" { figure-part(part) }
  else if part.kind == "text" { sized(10, part.body) }
}

#let sample-block(found) = block(width: 100%, inset: 7 * px, stacked(4, (
  ..if found.title != none { (sized(em * 1.1, found.title, weight: "bold"),) } else { () },
  part-of(found.part),
)))

#let body(sheet) = block(width: 100%, height: 100%, clip: true, if sheet.blocks.len() == 0 {
  block(width: 100%, height: 80 * px, radius: 3 * px, stroke: (paint: rgb("#999999"),
    thickness: 1 * px, dash: "dashed"), align(center + horizon, sized(em * 0.9, paper.empty, fill: dim-ink)))
} else {
  grid(columns: (1fr, 1fr), column-gutter: 8 * px, row-gutter: 8 * px,
    ..sheet.blocks.map(found => if found.half { sample-block(found) } else {
      grid.cell(colspan: 2, sample-block(found)) }))
})

#let footer(sheet) = grid(columns: (auto, 1fr, auto), align: bottom,
  sized(em * 0.8, sheet.footer, fill: dim-ink), [], sized(em * 0.8, sheet.numbering, fill: dim-ink))

#for sheet in paper.sheets {
  page(width: SHEET_WIDTH * px, height: SHEET_HEIGHT * px, margin: 28 * px,
    foreground: if paper.watermark { place(center + horizon, rotate(-30deg,
      sized(64, "DRAFT", fill: rgb(0, 0, 0, 5%), weight: "bold"))) },
    grid(rows: (auto, 1fr, auto), row-gutter: 12 * px,
      if sheet.head == "letterhead" { letterhead() } else if sheet.head == "running" { running() } else { [] },
      body(sheet), footer(sheet)))
}
