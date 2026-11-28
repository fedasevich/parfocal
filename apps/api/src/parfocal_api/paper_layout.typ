#let px = PAPER_PX * 1pt
#let paper = json(bytes(sys.inputs.paper))
#let ink = rgb("#111111")
#let dim-ink = rgb("#555555")
#let faint-ink = rgb("#666666")
#let label-ink = rgb("#444444")
#let foot-ink = rgb("#6b6b6b")
#let strong-line = rgb("#222222")
#let soft-line = rgb("#dddddd")
#set text(font: "IBM Plex Sans", size: 10 * px, fill: ink, fallback: true,
  top-edge: PAPER_TOP_EDGEem, bottom-edge: -PAPER_BOTTOM_EDGEem, tracking: PAPER_TRACKING * px)
#set par(leading: 0pt, spacing: 0pt, justify: false)
#set block(spacing: 0pt)
#set table(stroke: none, inset: 0pt)
#let mono(body) = text(font: "IBM Plex Mono", tracking: PAPER_MONO_TRACKING * px, body)
#let sized(size, body, fill: auto, weight: "regular") = text(size: size * px,
  tracking: if size >= 15 { PAPER_LARGE_TRACKING * px } else { PAPER_TRACKING * px },
  fill: if fill == auto { ink } else { fill }, weight: weight, body)
#let stacked(gap, items) = grid(columns: (100%,), row-gutter: gap * px, ..items)

#let clipped(width, words) = context {
  if measure(text(words)).width <= width { return text(words) }
  let chars = words.clusters()
  let keep = chars.len()
  while keep > 0 and measure(text(chars.slice(0, keep).join() + "…")).width > width { keep -= 1 }
  text(chars.slice(0, keep).join() + "…")
}

#let auto-widths(rows, first: none) = {
  let count = rows.at(0).len()
  range(count).map(column => {
    if column == 0 and first != none { return first }
    let widest = calc.max(..rows.map(row => measure(row.at(column)).width / 1pt))
    calc.max(widest, 0.01) * 1fr
  })
}

#let tile(head) = box(width: 28 * px, height: 28 * px, radius: 5 * px, fill: rgb("#0f766e"),
  align(center + horizon, sized(9, head.lab_short, fill: white, weight: "bold")))

#let letterhead(head) = block(width: 100%, inset: (bottom: 15 * px), outset: (bottom: -0.5 * px),
  stroke: (bottom: 1 * px + strong-line), layout(size => {
    let gap = 24 * px
    let name = sized(11, head.lab_name, weight: "bold")
    let kind = sized(8, head.kind, fill: dim-ink)
    let title = sized(15, head.title, weight: "bold")
    let lines = head.lines.map(line => sized(8, line, fill: dim-ink))
    let left-wide = 38 * px + calc.max(measure(name).width, measure(kind).width)
    let right-wide = calc.max(measure(title).width, ..lines.map(line => measure(line).width))
    let over = left-wide + right-wide + gap - size.width
    let share = left-wide + right-wide
    let left-width = if over > 0pt { left-wide - over * (left-wide / share) } else { left-wide }
    let right-width = if over > 0pt { right-wide - over * (right-wide / share) } else { right-wide }
    grid(columns: (left-width, 1fr, right-width),
      grid(columns: (28 * px, 10 * px, left-width - 38 * px), align: horizon, tile(head), [],
        stacked(0, (name, kind))),
      [],
      align(right, stacked(0, (title, ..lines))))
  }))

#let facts(pairs) = block(width: 100%, inset: (bottom: 15 * px), outset: (bottom: -0.5 * px),
  stroke: (bottom: 1 * px + rgb("#cccccc")), layout(size => {
    let width = (size.width - 32 * px) / 3
    let value(pair) = block(width: width, sized(10, pair.at(1), weight: "semibold"))
    let rows = range(calc.ceil(pairs.len() / 3)).map(at => pairs.slice(at * 3, calc.min(at * 3 + 3, pairs.len())))
    stacked(10, rows.map(row => {
      let tall = calc.max(..row.map(pair => measure(value(pair)).height))
      grid(columns: (width, width, width), column-gutter: 16 * px, ..row.map(pair => {
        let extra = (tall - measure(value(pair)).height) / 2
        stacked(0, (
          block(height: 10.5 * px + extra, sized(7.5, pair.at(0), fill: faint-ink)),
          block(height: 2 * px),
          value(pair),
        ))
      }))
    }))
  }))

#let tiles(part) = grid(columns: (1fr,) * 5, column-gutter: 8 * px,
  ..part.tiles.map(found => block(width: 100%, stroke: 1 * px + rgb("#cccccc"), radius: 3 * px,
    outset: -0.5 * px, inset: (x: 9 * px, y: 7 * px), stacked(4, (
      sized(17, mono(found.at(0)), weight: "semibold"),
      sized(7.5, found.at(1), fill: dim-ink),
    )))))

#let ruled-table(head, rows, first: none, tall: auto, align-last: left) = context {
  let widths = auto-widths(if head.len() > 0 { (head, ..rows) } else { rows }, first: first)
  let last = widths.len() - 1
  let place(at, cell) = if at == last { align(align-last, cell) } else { cell }
  table(columns: widths, align: left + horizon,
    ..if head.len() > 0 {
      (..head.enumerate().map(((at, cell)) => table.cell(inset: (bottom: 5 * px), place(at, cell))),
       table.hline(stroke: 1 * px + strong-line))
    } else { () },
    ..rows.map(row => (..row.enumerate().map(((at, cell)) => table.cell(inset: (top: 4 * px, bottom: 5 * px),
      box(height: tall, align(horizon, place(at, cell))))),
      table.hline(stroke: 1 * px + soft-line))).flatten())
}

#let paper-table(part) = ruled-table(
  part.head.map(cell => sized(8.5, cell, weight: "bold")),
  part.rows.map(row => row.enumerate().map(((at, cell)) => if at == 0 and part.mono_first {
    sized(8.5, mono(cell), weight: "semibold") } else { sized(8.5, cell) })),
  tall: if part.mono_first { 16 * px } else { auto })

#let answer-ink = (agree: rgb("#1f7a3a"), disagree: rgb("#b42318"), unsure: rgb("#9a6400"))

#let objects-table(part) = ruled-table(
  ([], sized(8.5, "ID", weight: "semibold"), sized(8.5, "Object", weight: "semibold"),
    ..part.people.map(name => sized(8.5, name, weight: "semibold"))),
  part.rows.map(row => ([], sized(8.5, mono(row.at(0)), weight: "semibold"), sized(8.5, row.at(1)),
    ..row.at(2).map(answer => sized(8.5, if answer == "unsure" { "unsure" } else { answer },
      weight: "semibold", fill: answer-ink.at(answer, default: ink))))),
  first: 48 * px, tall: 16 * px)

#let change-rows(part) = ruled-table((),
  part.rows.map(row => (sized(8.5, mono(row.at(0)), weight: "semibold"), sized(8.5, row.at(1)),
    sized(8.5, row.at(2)), sized(8.5, row.at(3)))),
  align-last: right)

#let matrix(part) = {
  let most = calc.max(1, ..part.counts.flatten())
  let cell = 48 * px
  let spacing = 2 * px
  let heads = part.classes.map(name => box(width: cell, align(center, sized(8.5, name, fill: label-ink))))
  let body = part.classes.enumerate().map(((row, name)) => (
    box(width: cell, height: 20 * px, inset: (right: 6 * px), align(right + horizon, sized(8.5, name, fill: label-ink))),
    ..part.classes.enumerate().map(((column, _)) => {
      let value = part.counts.at(row).at(column)
      let diagonal = row == column
      box(width: cell, height: 20 * px,
        fill: if diagonal { rgb(29, 95, 209, (0.25 + 0.45 * value / most) * 100%) } else { rgb("#eef3fb") },
        align(center + horizon, sized(8.5, str(value), weight: if diagonal { "bold" } else { "regular" })))
    }),
  ))
  let table-width = (part.classes.len() + 1) * (cell + spacing) + spacing
  stacked(8, (
    grid(columns: (10.5 * px, table-width), column-gutter: 6 * px, align: horizon,
      [], block(width: table-width, inset: (left: 56 * px), align(center,
        sized(7.5, "Consensus of the reviewers", fill: label-ink, weight: "semibold"))),
      rotate(-90deg, reflow: true, sized(7.5, "The AI said", fill: label-ink, weight: "semibold")),
      block(inset: spacing, grid(columns: (cell,) * (part.classes.len() + 1), gutter: spacing,
        box(width: cell), ..heads.map(head => box(height: 15.89 * px, head)), ..body.flatten()))),
    sized(7.5, part.caption, fill: faint-ink),
  ))
}

#let bars(part) = {
  let most = calc.max(1, ..part.rows.map(row => row.at(1)))
  stacked(6, (
    ..if part.heading != none { (sized(9, part.heading, weight: "semibold"),) } else { () },
    ..part.rows.map(row => grid(columns: (96 * px, 1fr, 22 * px), column-gutter: 8 * px, align: horizon,
      clipped(96 * px, row.at(0)),
      block(width: 100%, height: 7 * px, fill: rgb("#e6e6e6"),
        block(width: 100% * row.at(1) / most, height: 100%, fill: rgb("#1d5fd1"))),
      align(right, mono(str(row.at(1)))))),
  ))
}

#let part-of(part) = {
  let kind = part.kind
  if kind == "tiles" { tiles(part) }
  else if kind == "table" { paper-table(part) }
  else if kind == "objects" { objects-table(part) }
  else if kind == "matrix" { matrix(part) }
  else if kind == "bars" { bars(part) }
  else if kind == "lines" { stacked(part.gap, part.lines.map(line => line)) }
  else if kind == "note" { sized(7.5, part.text, fill: faint-ink) }
  else if kind == "empty" { block(width: 100%, radius: 3 * px, fill: rgb("#f6f4ef"), inset: 8 * px,
    text(fill: dim-ink, part.text)) }
  else if kind == "figure" { stacked(4, (block(width: 100%, height: 120 * px, fill: rgb("#eeeeee")),
    sized(7.5, part.caption, fill: faint-ink))) }
  else if kind == "changes" { change-rows(part) }
}

#let section(found) = stacked(8, (
  ..if found.title != none { (sized(9, found.title, weight: "bold"),) } else { () },
  stacked(6, found.parts.map(part-of)),
))

#let sections(found) = grid(columns: (1fr, 1fr), column-gutter: 24 * px, row-gutter: 24 * px,
  ..found.map(item => if item.half { section(item) } else { grid.cell(colspan: 2, section(item)) }))

#let sheet-page(sheet) = {
  let header-room = if sheet.header != none { 30.5 * px } else { 0pt }
  page(
    width: PAPER_WIDTH * px, height: PAPER_HEIGHT * px,
    margin: (left: 44 * px, right: 44 * px, top: 36 * px + header-room, bottom: 55.2 * px),
    header-ascent: 20 * px, footer-descent: 20 * px,
    header: if sheet.header != none { sized(7.5, sheet.header, fill: foot-ink) },
    footer: grid(columns: (1fr, auto), sized(8, sheet.footer, fill: foot-ink),
      if sheet.numbering != none { sized(8, sheet.numbering, fill: foot-ink) }),
    background: {
      if sheet.watermark != none { place(center + horizon, rotate(-30deg,
        sized(64, sheet.watermark, fill: rgb("#e4e4e4"), weight: "bold"))) }
      if paper.checksum != "" { place(bottom + left, dx: 44 * px, dy: -9 * px,
        sized(6, "Checksum " + paper.checksum, fill: foot-ink)) }
    },
    stacked(20, (
      ..if sheet.letterhead != none { (letterhead(sheet.letterhead), facts(sheet.facts)) } else { () },
      sections(sheet.sections),
    )),
  )
}

#for sheet in paper.sheets { sheet-page(sheet) }
